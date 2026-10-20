const crypto = require('crypto');
const webpush = require('web-push');
const { db, getSetting, setSetting } = require('./db');

let pub = getSetting('vapid_public'), priv = getSetting('vapid_private');
if (!pub || !priv) {
  const k = webpush.generateVAPIDKeys();
  setSetting('vapid_public', pub = k.publicKey); setSetting('vapid_private', priv = k.privateKey);
}
webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', pub, priv);

const secret = process.env.APP_SECRET || priv;
const sign = s => crypto.createHmac('sha256', secret).update(s).digest('hex').slice(0, 24);
const verify = (s, sig) => { try { return crypto.timingSafeEqual(Buffer.from(sign(s)), Buffer.from(String(sig))); } catch { return false; } };

async function sendAll(payload) {
  const subs = db.prepare('SELECT * FROM push_subs').all();
  let sent = 0;
  await Promise.all(subs.map(async s => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload));
      sent++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) db.prepare('DELETE FROM push_subs WHERE endpoint=?').run(s.endpoint);
      else console.error('push error', e.statusCode || e.message);
    }
  }));
  return sent;
}

module.exports = { publicKey: pub, sendAll, sign, verify };

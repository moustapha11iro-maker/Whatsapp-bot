const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const http = require('http');

// Petit serveur pour que Render ne coupe pas le bot
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Bot WhatsApp en ligne !');
}).listen(process.env.PORT || 3000, () => {
  console.log('Serveur web en ligne');
});

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth');
  
  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
  });

  sock.ev.on('creds.update', saveCreds);

  // Si pas encore connecté, demander le code de couplage
  if (!sock.authState.creds.registered) {
    const phone = process.env.PHONE_NUMBER; // Ex: 22790000000 sans +
    if (!phone) {
      console.log('⚠️ Mets ton numéro dans PHONE_NUMBER sur Render ! Ex: 22790000000');
    } else {
      setTimeout(async () => {
        try {
          const code = await sock.requestPairingCode(phone);
          console.log('=== TON CODE DE COUPLAGE : ' + code + ' ===');
          console.log('Va dans WhatsApp > Appareils liés > Lier un appareil > Lier avec un numéro');
        } catch (e) {
          console.log('Erreur code:', e.message);
        }
      }, 3000);
    }
  }

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Connexion fermée, reconnexion...', shouldReconnect);
      if (shouldReconnect) startBot();
    } else if (connection === 'open') {
      console.log('✅ Bot connecté à WhatsApp !');
    }
  });

  // Réponses automatiques
  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').toLowerCase().trim();
    const from = msg.key.remoteJid;

    let reply = null;

    if (text === '!ping') reply = '🏓 Pong ! Bot en ligne !';
    if (text === '!bonjour' || text === 'bonjour' || text === 'salut') reply = '👋 Bonjour ! Tape *!menu* pour voir les commandes.';
    if (text === '!menu' || text === '!aide' || text === '!help') {
      reply = `🤖 *MENU DU BOT*\n\n• !ping - Vérifier si le bot est en ligne\n• !bonjour - Dire bonjour\n• !menu - Voir ce menu\n• !info - Infos sur le bot\n• !heure - Heure actuelle`;
    }
    if (text === '!info') reply = '🤖 Je suis un bot WhatsApp simple créé avec Baileys. Je réponds aux commandes !menu, !ping, etc.';
    if (text === '!heure') reply = '🕒 Il est : ' + new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Niamey' });

    if (reply) {
      await sock.sendMessage(from, { text: reply });
    }
  });
}

startBot();

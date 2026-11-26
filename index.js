const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const http = require('http');
const XLSX = require('xlsx');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
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
        // --- ENVOI DE NOTES PAR FICHIER EXCEL ---
    if (msg.message?.documentMessage) {
      const doc = msg.message.documentMessage;
      const fileName = doc.fileName || '';
      if (!fileName.endsWith('.xlsx') && !fileName.endsWith('.xls')) {
        await sock.sendMessage(from, { text: '❌ Envoie-moi un fichier .xlsx s’il te plaît.' });
        return;
      }
      await sock.sendMessage(from, { text: '📥 Fichier reçu, je lis les notes...' });
      try {
        const stream = await downloadContentFromMessage(doc, 'document');
        let buffer = Buffer.from([]);
        for await (const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const notes = XLSX.utils.sheet_to_json(sheet);
        await sock.sendMessage(from, { text: `📋 J'ai trouvé ${notes.length} notes. J'envoie aux parents...` });
        let ok = 0; let echec = 0;
        for (let n of notes) {
          try {
            let tel = String(n.telephone_parent).replace(/[^0-9]/g, '');
            if (!tel.startsWith('227')) tel = '227' + tel;
            const msgParent = `Bonjour, 👋\n\nVotre enfant *${n.eleve}* (${n.classe}) a obtenu la note de *${n.note}/20* en *${n.matiere}*.\n\nMerci de suivre sa scolarité.\n- Direction de l'école`;
            await sock.sendMessage(tel + '@s.whatsapp.net', { text: msgParent });
            ok++;
            await new Promise(r => setTimeout(r, 2000));
          } catch (e) { echec++; }
        }
        await sock.sendMessage(from, { text: `✅ Terminé !\n\n✔️ Envoyé : ${ok} parents\n❌ Échec : ${echec}` });
      } catch (err) {
        console.log(err);
        await sock.sendMessage(from, { text: '❌ Erreur. Vérifie les colonnes : eleve, classe, matiere, note, telephone_parent' });
      }
      return;
    }

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

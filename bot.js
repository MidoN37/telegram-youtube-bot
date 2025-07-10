const TelegramBot = require('node-telegram-bot-api');
const ytdl = require('ytdl-core');
const fs = require('fs');
const express = require('express');

// --- SETUP ---
const token = process.env.BOT_TOKEN;
const port = process.env.PORT || 3000;
// Use the dedicated PUBLIC_URL environment variable we just set
const url = process.env.PUBLIC_URL;

if (!token || !url) {
    console.error('CRITICAL ERROR: BOT_TOKEN and PUBLIC_URL must be set in Railway variables.');
    process.exit(1);
}

const bot = new TelegramBot(token);

// Set the webhook with better logging
bot.setWebHook(`https://${url}/bot${token}`).then(() => {
    console.log(`✅ Webhook has been set successfully to https://${url}`);
}).catch((error) => {
    // This will now give a much clearer error message if something is wrong with the URL
    console.error('Error setting webhook:', error.message);
    process.exit(1);
});

console.log('🤖 Bot server has been started and is waiting for webhook confirmation...');

const app = express();
app.use(express.json());

// We are receiving updates at the route below!
app.post(`/bot${token}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

// --- COMMANDS & MAIN LOGIC (remains the same) ---

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const userFirstName = msg.from.first_name;
    const welcomeMessage = `
👋 Hello, ${userFirstName}! I'm your friendly YouTube Downloader Bot. 🤖

Just send me a YouTube link, and I'll help you download the video or audio. Let's get started! 🚀
    `;
    bot.sendMessage(chatId, welcomeMessage);
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const messageText = msg.text;
    if (messageText.startsWith('/')) {
        return;
    }

    if (ytdl.validateURL(messageText)) {
        try {
            bot.sendMessage(chatId, '🔎 Amazing! Let me check that link for you...');
            const videoId = ytdl.getVideoID(messageText);
            const info = await ytdl.getInfo(videoId);
            const title = info.videoDetails.title;
            bot.sendPhoto(chatId, `https://img.youtube.com/vi/${videoId}/0.jpg`, {
                caption: `🎬 **${title}**\n\nWhat format would you like? 🤔`,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📹 Video', callback_data: `video_${videoId}` }, { text: '🎵 Audio', callback_data: `audio_${videoId}` }]
                    ]
                }
            });
        } catch (error) {
            console.error(error);
            bot.sendMessage(chatId, '😔 Oops! Something went wrong. Please check if the YouTube link is correct and public.');
        }
    } else {
        bot.sendMessage(chatId, 'Hmm, that doesn\'t look like a YouTube link. Please send me a valid one! 👀');
    }
});

bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const [choice, videoId] = callbackQuery.data.split('_');
    const messageId = callbackQuery.message.message_id;

    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId });
    bot.answerCallbackQuery(callbackQuery.id);

    if (choice === 'audio') {
        try {
            bot.sendMessage(chatId, '🎧 Great choice! Downloading the best audio quality now. Please wait...');
            const audioStream = ytdl(videoId, { filter: 'audioonly', quality: 'highestaudio' });
            const filePath = `/tmp/${videoId}_audio.mp3`;
            const writeStream = fs.createWriteStream(filePath);

            audioStream.pipe(writeStream);
            writeStream.on('finish', () => {
                bot.sendAudio(chatId, filePath).then(() => {
                    fs.unlinkSync(filePath);
                });
            });
        } catch (error) {
            console.error(error);
            bot.sendMessage(chatId, '😔 An error occurred while downloading the audio. Please try again.');
        }
    } else if (choice === 'video') {
        try {
            const info = await ytdl.getInfo(videoId);
            const videoFormats = info.formats
                .filter(format => format.hasVideo && format.hasAudio && format.container === 'mp4')
                .sort((a, b) => b.height - a.height)
                .map(format => ({ text: `${format.height}p`, callback_data: `download_${videoId}_${format.itag}` }));
            bot.sendMessage(chatId, '✅ Awesome! Now, which quality would you like for the video?', {
                reply_markup: { inline_keyboard: [videoFormats] }
            });
        } catch (error) {
            console.error(error);
            bot.sendMessage(chatId, '😔 Sorry, I couldn\'t fetch the video formats. Please try another video.');
        }
    } else if (choice.startsWith('download')) {
        const [, vId, itag] = callbackQuery.data.split('_');
        try {
            bot.sendMessage(chatId, '📥 Perfect! Your video is downloading now. This might take a moment...');
            const videoStream = ytdl(vId, { filter: format => format.itag == itag });
            const filePath = `/tmp/${vId}_video.mp4`;
            const writeStream = fs.createWriteStream(filePath);
            videoStream.pipe(writeStream);
            writeStream.on('finish', () => {
                bot.sendVideo(chatId, filePath).then(() => {
                    fs.unlinkSync(filePath);
                });
            });
        } catch (error) {
            console.error(error);
            bot.sendMessage(chatId, '😔 There was an issue downloading the video in that quality. Please try another one.');
        }
    }
});

app.listen(port, () => {
    console.log(`Server is listening on port ${port}`);
});

const TelegramBot = require('node-telegram-bot-api');
const ytdl = require('ytdl-core');
const fs = require('fs');
const express = require('express');

// --- SETUP ---
const token = process.env.BOT_TOKEN;
const port = process.env.PORT || 3000;
const url = process.env.PUBLIC_URL;

if (!token || !url) {
    console.error('CRITICAL ERROR: BOT_TOKEN and PUBLIC_URL must be set in Railway variables.');
    process.exit(1);
}

// ** THE FIX IS HERE **
// Make requests look like they are coming from a browser to avoid YouTube's 410 error.
const ytdlOptions = {
    requestOptions: {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
        },
    },
};


const bot = new TelegramBot(token);

bot.setWebHook(`https://${url}/bot${token}`).then(() => {
    console.log(`✅ Webhook has been set successfully to https://${url}`);
}).catch((error) => {
    console.error('Error setting webhook:', error.message);
    process.exit(1);
});

console.log('🤖 Bot server has been started and is waiting for webhook confirmation...');

const app = express();
app.use(express.json());

app.post(`/bot${token}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

// --- COMMANDS & MAIN LOGIC ---

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
    if (messageText.startsWith('/')) { return; }

    if (ytdl.validateURL(messageText)) {
        try {
            bot.sendMessage(chatId, '🔎 Amazing! Let me check that link for you...');
            const videoId = await ytdl.getVideoID(messageText);
            // ** APPLYING THE FIX **
            const info = await ytdl.getInfo(videoId, ytdlOptions);
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
            console.error("Error getting video info:", error);
            bot.sendMessage(chatId, '😔 Oops! Something went wrong. This video might be private, age-restricted, or have other restrictions. Please try another one!');
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
            // ** APPLYING THE FIX **
            const audioStream = ytdl(videoId, { ...ytdlOptions, filter: 'audioonly', quality: 'highestaudio' });
            const filePath = `/tmp/${videoId}_audio.mp3`;
            const writeStream = fs.createWriteStream(filePath);
            audioStream.pipe(writeStream);
            writeStream.on('finish', () => {
                bot.sendAudio(chatId, filePath).then(() => {
                    fs.unlinkSync(filePath);
                });
            });
        } catch (error) {
            console.error("Error downloading audio:", error);
            bot.sendMessage(chatId, '😔 An error occurred while downloading the audio. Please try again.');
        }
    } else if (choice === 'video') {
        try {
            // ** APPLYING THE FIX **
            const info = await ytdl.getInfo(videoId, ytdlOptions);
            const videoFormats = info.formats
                .filter(format => format.hasVideo && format.hasAudio && format.container === 'mp4' && format.qualityLabel)
                .sort((a, b) => b.height - a.height)
                .map(format => ({ text: `${format.qualityLabel}`, callback_data: `download_${videoId}_${format.itag}` }));
            bot.sendMessage(chatId, '✅ Awesome! Now, which quality would you like for the video?', {
                reply_markup: { inline_keyboard: [videoFormats.map(f => ({text: f.text, callback_data: f.callback_data}))] }
            });
        } catch (error) {
            console.error("Error getting video formats:", error);
            bot.sendMessage(chatId, '😔 Sorry, I couldn\'t fetch the video formats. Please try another video.');
        }
    } else if (choice === 'download') {
        const [, vId, itag] = callbackQuery.data.split('_');
        try {
            bot.sendMessage(chatId, '📥 Perfect! Your video is downloading now. This might take a moment...');
            // ** APPLYING THE FIX **
            const videoStream = ytdl(vId, { ...ytdlOptions, filter: format => format.itag == itag });
            const filePath = `/tmp/${vId}_video.mp4`;
            const writeStream = fs.createWriteStream(filePath);
            videoStream.pipe(writeStream);
            writeStream.on('finish', () => {
                bot.sendVideo(chatId, filePath).then(() => {
                    fs.unlinkSync(filePath);
                });
            });
        } catch (error) {
            console.error("Error downloading video:", error);
            bot.sendMessage(chatId, '😔 There was an issue downloading the video in that quality. Please try another one.');
        }
    }
});

app.listen(port, () => {
    console.log(`Server is listening on port ${port}`);
});

const TelegramBot = require('node-telegram-bot-api');
const play = require('play-dl');
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

    // Use play-dl's validation method
    const validationResult = await play.validate(messageText);
    if (validationResult === 'yt_video') {
        try {
            await bot.sendMessage(chatId, '🔎 Amazing! Let me check that link for you...');
            
            // Use play-dl's video_info method
            const videoInfo = await play.video_info(messageText);
            const title = videoInfo.video_details.title;

            await bot.sendPhoto(chatId, videoInfo.video_details.thumbnails[0].url, {
                caption: `🎬 **${title}**\n\nWhat format would you like? 🤔`,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📹 Video', callback_data: `video_${videoInfo.video_details.id}` }, { text: '🎵 Audio', callback_data: `audio_${videoInfo.video_details.id}` }]
                    ]
                }
            });
        } catch (error) {
            console.error("Error in message handler:", error.message);
            await bot.sendMessage(chatId, '😔 Oops! Something went wrong. This video might be private, age-restricted, or have other restrictions. Please try another one!');
        }
    } else {
        await bot.sendMessage(chatId, 'Hmm, that doesn\'t look like a YouTube link. Please send me a valid one! 👀');
    }
});


bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;
    const [choice, videoId] = callbackQuery.data.split('_');

    await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId });
    await bot.answerCallbackQuery(callbackQuery.id);
    
    const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

    try {
        if (choice === 'audio') {
            await bot.sendMessage(chatId, '🎧 Great choice! Downloading the best audio quality now. Please wait...');
            const stream = await play.stream(youtubeUrl, {
                quality: 2 // 'best' quality for audio
            });
            await bot.sendAudio(chatId, stream.stream, { fileName: `${videoId}_audio.mp3` }, { contentType: 'audio/mpeg' });

        } else if (choice === 'video') {
            const videoInfo = await play.video_info(youtubeUrl);
            const videoFormats = videoInfo.format
                .filter(format => format.qualityLabel && format.mime_type.includes('mp4') && format.audio_channels)
                .sort((a, b) => b.height - a.height)
                .map(format => ({
                    text: `${format.qualityLabel}`,
                    callback_data: `download_${videoId}_${format.itag}`
                }));

            await bot.sendMessage(chatId, '✅ Awesome! Now, which quality would you like for the video?', {
                reply_markup: { inline_keyboard: [videoFormats] }
            });

        } else if (choice === 'download') {
            await bot.sendMessage(chatId, '📥 Perfect! Your video is downloading now. This might take a moment...');
            const [, , itag] = callbackQuery.data.split('_'); // [download, videoId, itag]
            
            const stream = await play.stream(youtubeUrl, {
                quality: parseInt(itag, 10) // download by specific itag
            });
            await bot.sendVideo(chatId, stream.stream, {}, { contentType: stream.type });
        }
    } catch (error) {
        console.error(`Error processing callback: ${choice}`, error.message);
        await bot.sendMessage(chatId, '😔 A critical error occurred. I could not process this request. Please try again with a different link.');
    }
});

app.listen(port, () => {
    console.log(`Server is listening on port ${port}`);
});

const TelegramBot = require('node-telegram-bot-api');
const ytdl = require('ytdl-core');
const fs = require('fs');

// Get the bot token from the environment variables. [9]
const token = process.env.BOT_TOKEN;

// Create a bot that uses 'polling' to fetch new updates.
const bot = new TelegramBot(token, { polling: true });

console.log('Bot has been started...');

// --- COMMANDS ---

// Handles the /start command
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const userFirstName = msg.from.first_name;

    const welcomeMessage = `
👋 Hello, ${userFirstName}! I'm your friendly YouTube Downloader Bot. 🤖

Just send me a YouTube link, and I'll help you download the video or audio. Let's get started! 🚀
    `;
    bot.sendMessage(chatId, welcomeMessage);
});

// --- MAIN LOGIC ---

// Listen for any message
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const messageText = msg.text;

    // Ignore commands
    if (messageText.startsWith('/')) {
        return;
    }

    // Check if the message is a valid YouTube URL. [4]
    if (ytdl.validateURL(messageText)) {
        try {
            bot.sendMessage(chatId, '🔎 Amazing! Let me check that link for you...');
            
            const videoId = ytdl.getVideoID(messageText);
            const info = await ytdl.getInfo(videoId);
            const title = info.videoDetails.title;

            // Send video thumbnail and ask for download format
            bot.sendPhoto(chatId, `https://img.youtube.com/vi/${videoId}/0.jpg`, {
                caption: `🎬 **${title}**\n\nWhat format would you like? 🤔`,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '📹 Video', callback_data: `video_${videoId}` },
                            { text: '🎵 Audio', callback_data: `audio_${videoId}` }
                        ]
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

// --- CALLBACK QUERY HANDLING ---

// Handle the user's choice from inline keyboards. [25]
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

            const filePath = `./${videoId}_audio.mp3`;
            const writeStream = fs.createWriteStream(filePath);

            audioStream.pipe(writeStream);

            writeStream.on('finish', () => {
                bot.sendAudio(chatId, filePath).then(() => {
                    fs.unlinkSync(filePath); // Clean up the file after sending
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
                .map(format => ({
                    text: `${format.height}p`,
                    callback_data: `download_${videoId}_${format.itag}`
                }));

            bot.sendMessage(chatId, '✅ Awesome! Now, which quality would you like for the video?', {
                reply_markup: {
                    inline_keyboard: [videoFormats]
                }
            });
        } catch (error) {
            console.error(error);
            bot.sendMessage(chatId, '😔 Sorry, I couldn\'t fetch the video formats. Please try another video.');
        }
    } else if (choice === 'download') {
        const [, videoId, itag] = callbackQuery.data.split('_');

        try {
            bot.sendMessage(chatId, '📥 Perfect! Your video is downloading now. This might take a moment...');
            const videoStream = ytdl(videoId, { filter: format => format.itag == itag });
            const filePath = `./${videoId}_video.mp4`;

            const writeStream = fs.createWriteStream(filePath);

            videoStream.pipe(writeStream);
            writeStream.on('finish', () => {
                bot.sendVideo(chatId, filePath).then(() => { // [31, 34, 42]
                    fs.unlinkSync(filePath); // Clean up
                });
            });

        } catch (error) {
            console.error(error);
            bot.sendMessage(chatId, '😔 There was an issue downloading the video in that quality. Please try another one.');
        }
    }
});

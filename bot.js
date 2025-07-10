const { Telegraf } = require('telegraf');
const ytdl = require('ytdl-core');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');

// Initialize the Telegraf bot with the token from environment variables
const bot = new Telegraf(process.env.BOT_TOKEN);

// Use a Map to temporarily store the YouTube URL for each user
const userUrl = new Map();

// Define the disclaimer message
const disclaimer = "Disclaimer: This bot should be used at your own risk. Only download content that you own or that is in the public domain.";

// Handler for the /start command
bot.start((ctx) => ctx.reply(`Welcome! Send me a YouTube URL to get started.\n\n${disclaimer}`));

// Handler for when a user sends any text message
bot.on('text', async (ctx) => {
    const url = ctx.message.text;
    
    // Check if the text looks like a YouTube URL
    if (/^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.?be)\/.+$/.test(url)) {
        try {
            // Validate the URL with ytdl-core
            const valid = ytdl.validateURL(url);
            if (!valid) {
                return ctx.reply('Please send a valid YouTube URL.');
            }
            
            // Store the URL with the user's chat ID
            userUrl.set(ctx.chat.id, url);
            
            // Ask the user to choose a format using inline buttons
            ctx.reply('Great! In which format would you like to download?', {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Video (mp4)', callback_data: 'video' }],
                        [{ text: 'Audio (mp3)', callback_data: 'audio' }]
                    ]
                }
            });
        } catch (error) {
            ctx.reply('Please send a valid YouTube URL.');
        }
    } else {
        ctx.reply('Please send a valid YouTube URL.');
    }
});

// Handler for when a user clicks one of the inline buttons ('video' or 'audio')
bot.on('callback_query', async (ctx) => {
    const format = ctx.callbackQuery.data;
    const chatId = ctx.chat.id;
    const url = userUrl.get(chatId);
    
    if (!url) {
        return ctx.reply('Something went wrong. Please send the YouTube URL again.');
    }
    
    // Let the user know the download is starting
    ctx.answerCbQuery(`Fetching your ${format}...`);
    await ctx.reply(`Starting the download for your ${format}. This may take a moment...`);
    
    try {
        // Get video info
        const info = await ytdl.getInfo(url);
        const title = info.videoDetails.title.replace(/[^\w\s]/gi, ''); // Clean filename
        
        // Define a temporary path to save the file
        const tempDir = os.tmpdir();
        const timestamp = Date.now();
        
        if (format === 'video') {
            const filePath = path.join(tempDir, `${timestamp}.mp4`);
            
            // Download video in mp4 format
            const stream = ytdl(url, {
                quality: 'highest',
                filter: format => format.container === 'mp4'
            });
            
            const writeStream = fs.createWriteStream(filePath);
            stream.pipe(writeStream);
            
            stream.on('end', async () => {
                try {
                    // Check file size (Telegram has a 50MB limit)
                    const stats = fs.statSync(filePath);
                    const fileSizeInMB = stats.size / (1024 * 1024);
                    
                    if (fileSizeInMB > 50) {
                        fs.unlinkSync(filePath);
                        return ctx.reply('Sorry, the video file is too large (>50MB). Telegram has a file size limit.');
                    }
                    
                    await ctx.replyWithVideo({ source: filePath });
                    fs.unlinkSync(filePath);
                    userUrl.delete(chatId);
                } catch (error) {
                    console.error('Error sending video:', error);
                    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                    ctx.reply('Sorry, something went wrong while sending the video.');
                }
            });
            
            stream.on('error', (error) => {
                console.error('Download error:', error);
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                ctx.reply('Sorry, something went wrong during download.');
            });
            
        } else {
            // Audio download
            const filePath = path.join(tempDir, `${timestamp}.mp3`);
            const tempAudioPath = path.join(tempDir, `${timestamp}_temp.mp4`);
            
            // Download audio stream
            const stream = ytdl(url, {
                quality: 'highestaudio',
                filter: 'audioonly'
            });
            
            const writeStream = fs.createWriteStream(tempAudioPath);
            stream.pipe(writeStream);
            
            stream.on('end', () => {
                // Convert to mp3 using ffmpeg
                ffmpeg(tempAudioPath)
                    .toFormat('mp3')
                    .on('end', async () => {
                        try {
                            // Check file size
                            const stats = fs.statSync(filePath);
                            const fileSizeInMB = stats.size / (1024 * 1024);
                            
                            if (fileSizeInMB > 50) {
                                fs.unlinkSync(filePath);
                                fs.unlinkSync(tempAudioPath);
                                return ctx.reply('Sorry, the audio file is too large (>50MB). Telegram has a file size limit.');
                            }
                            
                            await ctx.replyWithAudio({ source: filePath });
                            fs.unlinkSync(filePath);
                            fs.unlinkSync(tempAudioPath);
                            userUrl.delete(chatId);
                        } catch (error) {
                            console.error('Error sending audio:', error);
                            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                            if (fs.existsSync(tempAudioPath)) fs.unlinkSync(tempAudioPath);
                            ctx.reply('Sorry, something went wrong while sending the audio.');
                        }
                    })
                    .on('error', (error) => {
                        console.error('FFmpeg error:', error);
                        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                        if (fs.existsSync(tempAudioPath)) fs.unlinkSync(tempAudioPath);
                        ctx.reply('Sorry, something went wrong during audio conversion.');
                    })
                    .save(filePath);
            });
            
            stream.on('error', (error) => {
                console.error('Download error:', error);
                if (fs.existsSync(tempAudioPath)) fs.unlinkSync(tempAudioPath);
                ctx.reply('Sorry, something went wrong during download.');
            });
        }
        
    } catch (error) {
        console.error('Full error details:', error);
        ctx.reply('Sorry, something went wrong. The video might be private, restricted, or unavailable.');
        userUrl.delete(chatId);
    }
});

// Start the bot using polling
bot.launch();

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

console.log('Bot is running...');

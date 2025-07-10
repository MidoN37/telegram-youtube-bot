const { Telegraf } = require('telegraf');
const ytdl = require('@distube/ytdl-core');
const fs = require('fs');
const os = require('os');
const path = require('path');

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
        // Get video info first to check if it's available
        const info = await ytdl.getInfo(url);
        const title = info.videoDetails.title.replace(/[^\w\s-]/gi, '').substring(0, 50); // Clean and limit filename
        
        // Check video duration (limit to 10 minutes to avoid large files)
        const duration = parseInt(info.videoDetails.lengthSeconds);
        if (duration > 600) { // 10 minutes
            userUrl.delete(chatId);
            return ctx.reply('Sorry, the video is too long (>10 minutes). Please try a shorter video.');
        }
        
        // Define a temporary path to save the file
        const tempDir = os.tmpdir();
        const timestamp = Date.now();
        const sanitizedTitle = title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        
        if (format === 'video') {
            const filePath = path.join(tempDir, `${sanitizedTitle}_${timestamp}.mp4`);
            
            // Download video - use lower quality to avoid issues
            const stream = ytdl(url, {
                quality: 'lowest',
                filter: format => format.container === 'mp4' && format.hasVideo && format.hasAudio
            });
            
            const writeStream = fs.createWriteStream(filePath);
            
            stream.pipe(writeStream);
            
            stream.on('end', async () => {
                try {
                    // Check if file exists and has content
                    if (!fs.existsSync(filePath)) {
                        return ctx.reply('Sorry, failed to download the video.');
                    }
                    
                    const stats = fs.statSync(filePath);
                    const fileSizeInMB = stats.size / (1024 * 1024);
                    
                    if (fileSizeInMB > 50) {
                        fs.unlinkSync(filePath);
                        return ctx.reply('Sorry, the video file is too large (>50MB). Try a shorter video.');
                    }
                    
                    if (fileSizeInMB < 0.1) {
                        fs.unlinkSync(filePath);
                        return ctx.reply('Sorry, the video file seems to be empty or corrupted.');
                    }
                    
                    await ctx.replyWithVideo({ source: filePath });
                    fs.unlinkSync(filePath);
                    userUrl.delete(chatId);
                } catch (error) {
                    console.error('Error sending video:', error);
                    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                    ctx.reply('Sorry, failed to send the video. The file might be corrupted.');
                }
            });
            
            stream.on('error', (error) => {
                console.error('Video download error:', error);
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                ctx.reply('Sorry, failed to download the video. It might be restricted or unavailable.');
            });
            
        } else {
            // Audio download
            const filePath = path.join(tempDir, `${sanitizedTitle}_${timestamp}.mp3`);
            
            // Download audio only
            const stream = ytdl(url, {
                quality: 'lowestaudio',
                filter: 'audioonly'
            });
            
            const writeStream = fs.createWriteStream(filePath);
            stream.pipe(writeStream);
            
            stream.on('end', async () => {
                try {
                    // Check if file exists and has content
                    if (!fs.existsSync(filePath)) {
                        return ctx.reply('Sorry, failed to download the audio.');
                    }
                    
                    const stats = fs.statSync(filePath);
                    const fileSizeInMB = stats.size / (1024 * 1024);
                    
                    if (fileSizeInMB > 50) {
                        fs.unlinkSync(filePath);
                        return ctx.reply('Sorry, the audio file is too large (>50MB). Try a shorter video.');
                    }
                    
                    if (fileSizeInMB < 0.01) {
                        fs.unlinkSync(filePath);
                        return ctx.reply('Sorry, the audio file seems to be empty or corrupted.');
                    }
                    
                    await ctx.replyWithAudio({ source: filePath });
                    fs.unlinkSync(filePath);
                    userUrl.delete(chatId);
                } catch (error) {
                    console.error('Error sending audio:', error);
                    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                    ctx.reply('Sorry, failed to send the audio. The file might be corrupted.');
                }
            });
            
            stream.on('error', (error) => {
                console.error('Audio download error:', error);
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                ctx.reply('Sorry, failed to download the audio. It might be restricted or unavailable.');
            });
        }
        
    } catch (error) {
        console.error('Full error details:', error);
        
        // Handle specific error types
        if (error.statusCode === 410) {
            ctx.reply('Sorry, this video is no longer available or has been removed.');
        } else if (error.statusCode === 403) {
            ctx.reply('Sorry, this video is private or restricted.');
        } else if (error.message && error.message.includes('Video unavailable')) {
            ctx.reply('Sorry, this video is unavailable in your region or has been removed.');
        } else {
            ctx.reply('Sorry, something went wrong. The video might be private, restricted, or temporarily unavailable.');
        }
        
        userUrl.delete(chatId);
    }
});

// Error handling for the bot
bot.catch((err, ctx) => {
    console.error('Bot error:', err);
    ctx.reply('Sorry, an unexpected error occurred. Please try again.');
});

// Start the bot using polling
bot.launch();

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

console.log('Bot is running...');

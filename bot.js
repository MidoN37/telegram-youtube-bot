const { Telegraf } = require('telegraf');
const YtDlpWrap = require('yt-dlp-wrap').default;
const fs = require('fs');
const os = require('os');
const path = require('path');

// Create an instance of the YtDlpWrap class
const ytDlpWrap = new YtDlpWrap();

// Initialize the Telegraf bot with the token from environment variables
const bot = new Telegraf(process.env.BOT_TOKEN);

// Flag to track if binary is initialized
let binaryInitialized = false;

// Initialize the yt-dlp binary
const initBinary = async () => {
  if (binaryInitialized) return;
  
  try {
    console.log('Downloading yt-dlp binary...');
    const binaryPath = './yt-dlp';
    await YtDlpWrap.downloadFromGithub(binaryPath);
    ytDlpWrap.setBinaryPath(binaryPath);
    binaryInitialized = true;
    console.log('yt-dlp binary initialized successfully');
  } catch (error) {
    console.error('Failed to download yt-dlp binary:', error);
    throw error;
  }
};

// Use a Map to temporarily store the YouTube URL for each user
const userUrl = new Map();

// Define the disclaimer message
const disclaimer = "Disclaimer: This bot should be used at your own risk. Only download content that you own or that is in the public domain.";

// Handler for the /start command
bot.start((ctx) => ctx.reply(`Welcome! Send me a YouTube URL to get started.\n\n${disclaimer}`));

// Handler for when a user sends any text message
bot.on('text', async (ctx) => {
  const url = ctx.message.text;
  
  // Simple check to see if the text looks like a YouTube URL
  if (/^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.?be)\/.+$/.test(url)) {
    // If it's a valid URL, store it with the user's chat ID
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
    // Initialize binary if not already done
    await initBinary();
    
    // Define a temporary path to save the file
    const tempDir = os.tmpdir();
    const filePath = path.join(tempDir, `${Date.now()}.${format === 'video' ? 'mp4' : 'mp3'}`);
    
    // Set up the arguments for the yt-dlp command
    const ytDlpArgs = [
      url,
      '-o', filePath,
    ];
    
    if (format === 'audio') {
      ytDlpArgs.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
    } else {
      // This format selection tries to get the best mp4 file up to 1080p to avoid long downloads
      ytDlpArgs.push('-f', 'bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4]/best');
    }
    
    // Execute the yt-dlp command
    await ytDlpWrap.execPromise(ytDlpArgs);
    
    // Send the file to the user
    if (format === 'video') {
      await ctx.replyWithVideo({ source: filePath });
    } else {
      await ctx.replyWithAudio({ source: filePath });
    }
    
    // Clean up by deleting the temporary file and the stored URL
    fs.unlinkSync(filePath);
    userUrl.delete(chatId);
    
  } catch (error) {
    console.error('Full error details:', error);
    ctx.reply('Sorry, something went wrong. The video might be too long, private, or copyrighted, which prevents downloading.');
  }
});

// Start the bot using polling (for Railway)
bot.launch();

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

console.log('Bot is running...');

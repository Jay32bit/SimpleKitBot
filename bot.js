// PLEASE NOTE THAT YOU MUST EDIT THE CODE TO FIT YOUR NEEDS!
//THIS VERSION OF THE CODE ONLY SUPPORTS OFFLINE MINECRAFT SERVERS
//YOU WILL NEED TO PREFERABLY INSTALL mineflayer and mineflayer-pathfinder in the nodejs terminal beforehand!!
//Made by Jay32bit

const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals: { GoalBlock } } = require('mineflayer-pathfinder');
const Vec3 = require('vec3');
const fs = require('fs');
let kitsDelivered = 0;
let kitsInStock = 0;
const statsFile = 'kit_stats.json';
const kitRequestsFile = 'kit_requests.txt';
const kitStockFile = 'kit_stock.json';
const kitRequests = new Map();
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function loadKitStats() {
    try {
        if (fs.existsSync(statsFile)) {
            const data = fs.readFileSync(statsFile, 'utf8');
            const stats = JSON.parse(data);
            kitsDelivered = stats.kitsDelivered || 0;
        }
        if (fs.existsSync(kitStockFile)) {
            const data = fs.readFileSync(kitStockFile, 'utf8');
            const stats = JSON.parse(data);
            kitsInStock = stats.kitsInStock || 5000;
        } else {
            kitsInStock = 5000;
        }
    } catch (err) {
        console.error(`❌ Error loading kit stats: ${err}`);
    }
}

function saveKitStats() {
    try {
        fs.writeFileSync(statsFile, JSON.stringify({ kitsDelivered }), 'utf8');
        fs.writeFileSync(kitStockFile, JSON.stringify({ kitsInStock }), 'utf8');
    } catch (err) {
        console.error(`❌ Error saving kit stats: ${err}`);
    }
}

function loadKitRequests() {
    try {
        if (fs.existsSync(kitRequestsFile)) {
            const data = fs.readFileSync(kitRequestsFile, 'utf8');
            const lines = data.trim().split('\n');
            for (const line of lines) {
                const [username, count] = line.split(': ').map(item => item.trim());
                if (username && count) {
                    kitRequests.set(username, parseInt(count, 10));
                }
            }
        }
    } catch (err) {
        console.error(`❌ Error loading kit requests: ${err}`);
    }
}

function saveKitRequests() {
    try {
        const sortedRequests = Array.from(kitRequests.entries())
            .sort((a, b) => a[1] - b[1]);
        const data = sortedRequests.map(([username, count]) => `${username}: ${count}`).join('\n');
        fs.writeFileSync(kitRequestsFile, data, 'utf8');
    } catch (err) {
        console.error(`❌ Error saving kit requests: ${err}`);
    }
}
loadKitStats();
loadKitRequests();

const CONFIG = {
    host: 'test.minecraft.server', //ENTER YOUR SERVER IP HERE
    port: 25565,
    username: 'IntelBOT', //ENTER YOUR BOT ACCOUNT'S IGN HERE!
    chestCoords: { x: 0, y: 69, z: 0 }, //this is the coords of the chest that contains the kit!
    loginCommand: '/login password', 
    registerCommand: '/register password password', 
    adMessages: [
        // 
    ],
    adInterval: 15_000,
    kitItems: [
        { name: '<replace with the item ID>', count: 1 } //Example : white_shulker_box
    ],
    kitCooldown: 9_700 //This means theres a cooldown of 9.7 seconds! Change it as you prefer!
};

function startBot() {
    const bot = mineflayer.createBot({
        host: CONFIG.host,
        port: CONFIG.port,
        username: CONFIG.username,
    });

    let minecraftData = null;
    let mcDataReady = false;
    let _awaitingTeleport = false;
    let teleportTarget = null;
    let teleportTimeout = null;
    let processingKitRequest = false;
    let hasKit = false;
    let hasDied = false;
    let killInProgress = false;
    let kitLoadFailureCount = 0;
    let isAuthenticated = false; 

    bot.once('spawn', () => {
        console.log('✅ Bot spawned and connected successfully');
    });

    bot.once('login', () => {
        console.log('✅ Bot logged in successfully');
        const mcDataModule = require('minecraft-data');
        try {
            minecraftData = mcDataModule(bot.version);
            console.log('✅ mcData initialized successfully');
        } catch (error) {
            console.error(`❌ Error initializing mcData: ${error.message}`);
            minecraftData = null;
        }
        mcDataReady = !!minecraftData;

        // Send login command after 5 seconds to avoid being rate limited or kicked due to spamming
        setTimeout(() => {
            bot.chat(CONFIG.loginCommand);
            console.log(`🔑 Sent login command: ${CONFIG.loginCommand}`);
        }, 5000);

        if (mcDataReady) {
            bot.loadPlugin(pathfinder);
            // Delay kit loading until authentication is confirmed (to swap servers)
            startAdInterval();
        } else {
            console.warn('⚠️ mcData failed to initialize. Kit loading and pathfinding will not work.');
        }
    });

    bot.on('message', async (msg) => {
        const text = msg.toString();
        console.log(`📩 Raw server message: ${text}`); 

        if (text.match(/please\s*(?:type|run|use)?\s*\/login/i) || text.match(/authenticate\s*by\s*using\s*\/login/i)) {
            console.log('🔍 Detected login prompt');
            bot.chat(CONFIG.loginCommand);
            console.log(`🔑 Sent login command: ${CONFIG.loginCommand}`);
        } else if (text.match(/invalid\s*password|login\s*failed/i)) {
            console.log('❌ Login failed, attempting registration');
            bot.chat(CONFIG.registerCommand);
            console.log(`🔑 Sent register command: ${CONFIG.registerCommand}`);
            setTimeout(() => {
                bot.chat(CONFIG.loginCommand);
                console.log(`🔑 Retried login command: ${CONFIG.loginCommand}`);
            }, 2000); 
        } else if (text.match(/successfully\s*(?:logged\s*in|authenticated)/i)) {
            console.log('✅ Login successful');
            isAuthenticated = true;
            setTimeout(async () => {
                hasKit = await hasItemInInventory(CONFIG.kitItems[0].name);
                if (!hasKit) {
                    await attemptKitLoad();
                }
            }, 2000);
        } else if (text.match(/verify|captcha|click\s*to\s*verify/i)) {
            console.warn('⚠️ Anti-bot verification detected. Manual intervention may be required.');
            bot.chat(`/msg ${CONFIG.username} Anti-bot verification detected. Please verify manually.`);
        }

        const chatMatch = text.match(/^(?:\[.*?\]\s*)?<([^>]+)>\s*(.+)$/i);
        if (chatMatch) {
            const username = chatMatch[1].trim();
            const message = chatMatch[2].trim();
            const cleanMessage = message.toLowerCase();

            if (username === CONFIG.username) {
                console.log(`⚠️ Ignoring command from self: ${username}`);
                return;
            }

            if (cleanMessage.startsWith('?')) {
                await handleCommand(username, cleanMessage, false);
            }
            return;
        }

        const whisperMatch = text.match(/^([.\w]{1,16})\s+whispers:\s*(.+)$/i);
        if (whisperMatch) {
            const username = whisperMatch[1].trim();
            const message = whisperMatch[2].trim();
            const cleanMessage = message.toLowerCase();

            if (username === CONFIG.username) {
                console.log(`⚠️ Ignoring whisper from self: ${username}`);
                return;
            }

            if (cleanMessage.startsWith('?')) {
                await handleCommand(username, cleanMessage, true);
            }
            return;
        }

        console.log('⚠️ Message did not match expected chat or whisper format');
    });

}
function startBot() {
    const bot = mineflayer.createBot({
        host: CONFIG.host,
        port: CONFIG.port,
        username: CONFIG.username,
    });

    let minecraftData = null;
    let mcDataReady = false;
    let _awaitingTeleport = false;
    let teleportTarget = null;
    let teleportTimeout = null;
    let processingKitRequest = false; // Flag to prevent concurrent kit requests
    let hasKit = false; // Tracks whether the bot has a kit in its inventory
    let hasDied = false; // Tracks if the bot has died after /kill
    let killInProgress = false; // Prevents multiple /kill attempts
    let kitLoadFailureCount = 0; // Tracks consecutive kit load failures

bot.once('spawn', () => {
    console.log('✅ Bot spawned and connected successfully');
});

bot.once('login', () => {
    console.log('✅ Bot logged in successfully');
    const mcDataModule = require('minecraft-data');
    try {
        minecraftData = mcDataModule(bot.version);
        console.log('✅ mcData initialized successfully');
    } catch (error) {
        console.error(`❌ Error initializing mcData: ${error.message}`);
        minecraftData = null;
    }
    mcDataReady = !!minecraftData;


    setTimeout(() => {
        bot.chat(CONFIG.loginCommand);
        console.log(`🔑 Sent login command: ${CONFIG.loginCommand}`);
    }, 5000); // 5000ms = 5 seconds delay

    if (mcDataReady) {
        bot.loadPlugin(pathfinder);
        setTimeout(async () => {
            hasKit = await hasItemInInventory(CONFIG.kitItems[0].name);
            if (!hasKit) {
                await attemptKitLoad();
            }
        }, 2000);
        startAdInterval(); 
    } else {
        console.warn('⚠️ mcData failed to initialize. Kit loading and pathfinding will not work.');
    }
});
    function startAdInterval() {
        if (adInterval) clearInterval(adInterval); 
        adInterval = setInterval(() => {
            const message = CONFIG.adMessages[Math.floor(Math.random() * CONFIG.adMessages.length)];
            bot.chat(message);
            console.log(`📣 Sent ad: ${message}`);
        }, CONFIG.adInterval);
    }

    async function hasItemInInventory(itemName) {
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const item = bot.inventory.items().find(invItem => invItem.name === itemName);
                return !!item;
            } catch (err) {
                if (err.name === 'PartialReadError') {
                    console.warn(`⚠️ PartialReadError in inventory check (attempt ${attempt + 1}/3): ${err.message}`);
                    await sleep(1000); 
                    continue;
                }
                console.error(`❌ Error checking inventory: ${err.message}`);
                return false;
            }
        }
        console.warn('⚠️ Failed to check inventory after 3 attempts');
        return false;
    }

    async function findChest() {
        try {
            const chest = bot.findBlock({
                matching: block => block.name === 'chest',
                maxDistance: 5 
            });
            if (chest) {
                console.log('✅ Found nearby chest at coordinates:', chest.position);
                return chest;
            } else {
                console.warn('⚠️ No chest found within 5 blocks');
                return null;
            }
        } catch (err) {
            console.error(`❌ Error finding chest: ${err.message}`);
            return null;
        }
    }

    async function attemptKitLoad() {
        let success = false;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const chestBlock = await findChest();
                if (!chestBlock) {
                    console.warn('⚠️ No chest available to load kit, attempt:', attempt + 1);
                    continue;
                }
                const chest = await openChest(chestBlock);
                if (!chest) {
                    console.warn('⚠️ Could not open the chest, attempt:', attempt + 1);
                    continue;
                }
                for (const { name, count } of CONFIG.kitItems) {
                    const itemData = minecraftData.itemsByName[name];
                    if (itemData) {
                        const hasItem = await hasItemInInventory(name);
                        if (!hasItem) {
                            await chest.withdraw(itemData.id, null, count);
                            console.log('✅ Kit restocked successfully with item:', name);
                            hasKit = true;
                            success = true;
                        } else {
                            console.log('ℹ️ Kit already in inventory with item:', name);
                            hasKit = true;
                            success = true;
                        }
                    } else {
                        console.warn(`⚠️ Item "${name}" not found in mcData`);
                    }
                }
                if (chest) chest.close();
                if (success) {
                    kitLoadFailureCount = 0; 
                    return;
                }
            } catch (err) {
                if (err.name === 'PartialReadError') {
                    console.warn(`⚠️ PartialReadError in kit load (attempt ${attempt + 1}/3): ${err.message}`);
                    await sleep(1000); 
                    continue;
                }
                console.error(`❌ Error in attemptKitLoad: ${err.message}`);
            }
        }
        console.warn('⚠️ Failed to load kit after 3 attempts');
        kitLoadFailureCount++;
        console.log(`🔍 Kit load failure count: ${kitLoadFailureCount}, hasKit: ${hasKit}`);
        hasKit = await hasItemInInventory(CONFIG.kitItems[0].name); 
        if (kitLoadFailureCount >= 10 && !killInProgress && !hasKit) {
            console.log('🔄 10 consecutive kit load failures detected, initiating /kill');
            bot.chat('/kill');
            killInProgress = true;
            kitLoadFailureCount = 0; 
            await sleep(2000); // Wait for respawn
            await attemptKitLoad(); // Retry loading kit after respawn
        }
    }

    async function openChest(chestBlock) {
        if (!chestBlock || chestBlock.name !== 'chest') {
            console.warn(`⚠️ Invalid chest block at position: ${chestBlock ? chestBlock.position : 'null'}`);
            return null;
        }
        try {
            const openedChest = await bot.openChest(chestBlock);
            return openedChest;
        } catch (err) {
            console.error(`❌ Error opening chest: ${err.message}`);
            return null;
        }
    }

    async function executeKillWithRetry(timeoutMs = 15000) {
        if (killInProgress) {
            console.log(`⚠️ Kill attempt skipped; already in progress`);
            return Promise.resolve(false);
        }
        killInProgress = true;
        console.log(`🔄 Starting /kill attempt; timeout set to ${timeoutMs}ms`);

        return new Promise((resolve) => {
            const timeout = setTimeout(async () => {
                console.warn('⚠️ /kill timeout after 15s, checking bot state');
                const isAlive = bot.health > 0; // Check if bot is still alive
                if (!isAlive) {
                    console.log('✅ Bot appears dead despite timeout');
                    killInProgress = false;
                    resolve(true); // Assume success if bot is dead
                } else {
                    console.error('❌ /kill failed, bot still alive');
                    killInProgress = false;
                    resolve(false);
                }
            }, timeoutMs);

            bot.once('death', () => {
                console.log('✅ /kill successful, death event detected');
                clearTimeout(timeout);
                killInProgress = false;
                resolve(true);
            });

            bot.chat('/kill');
            console.log('🔄 /kill command sent');
        });
    }

    function getRemainingCooldown(username) {
        const cooldownEnd = cooldownMap.get(username);
        if (!cooldownEnd) return 0;
        const now = Date.now();
        const remaining = cooldownEnd - now;
        return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
    }

    function setCooldown(username, cooldownMs) {
        const cooldownEnd = Date.now() + cooldownMs;
        cooldownMap.set(username, cooldownEnd);
    }

    async function handleCommand(username, cleanMessage, isWhisper = false) {
        // Log specific command responses with emojis
        switch (cleanMessage.slice(1).split(' ')[0]) {
            case 'help':
                console.log(`📚 Help menu sent to ${username} via ${isWhisper ? 'whisper' : 'chat'}`);
                break;
            case 'kits':
                console.log(`🎒 Kit info sent to ${username} via ${isWhisper ? 'whisper' : 'chat'}`);
                break;
            case 'stats':
                console.log(`📊 Stats sent to ${username} via ${isWhisper ? 'whisper' : 'chat'}`);
                break;
            case 'coinflip':
            case 'cf':
                console.log(`🎲 Coinflip result sent to ${username} via ${isWhisper ? 'whisper' : 'chat'}`);
                break;
            case 'boop':
                console.log(`🐾 Boop sent to ${username} via /msg`);
                break;
            case 'dance':
                console.log(`💃 Dance command sent to ${username} via ${isWhisper ? 'whisper' : 'chat'}`);
                break;
            case 'joke':
                console.log(`😂 Joke sent to ${username} via ${isWhisper ? 'whisper' : 'chat'}`);
                break;
            case 'hug':
                console.log(`🤗 Hug sent to ${username} via ${isWhisper ? 'whisper' : 'chat'}`);
                break;
            case 'kit':
                console.log(`🎁 Kit request from ${username} via ${isWhisper ? 'whisper' : 'chat'}`);
                break;
            case 'cooldown':
                console.log(`⏳ Cooldown info sent to ${username} via ${isWhisper ? 'whisper' : 'chat'}`);
                break;
            case 'botping':
                console.log(`📡 Bot ping sent to ${username} via ${isWhisper ? 'whisper' : 'chat'}`);
                break;
        }

        const command = cleanMessage.slice(1).split(' ')[0];

        if (command === 'kit') {
            // Check if a request is already in progress or queued
            if (processingKitRequest || requestsQueue.length > 0) {
                const response = '&eHey! &cI’m currently handling another kit request! &ePlease try again later!';
                bot.chat(`/msg ${username} ${response}`);
                return;
            }

            // Check cooldown for this specific user
            const remainingCooldown = getRemainingCooldown(username);
            if (remainingCooldown > 0) {
                const response = `&ePlease wait &a${remainingCooldown} &esecond(s) before requesting another kit!`;
                bot.chat(`/msg ${username} ${response}`);
                return;
            }

            requestsQueue.push(username);
            processNextRequest();

            async function processNextRequest() {
                if (requestsQueue.length === 0) return;

                const currentUsername = requestsQueue[0];
                if (currentUsername !== username) return; // Skip if not the current user's turn

                processingKitRequest = true;

                // Recheck inventory right before sending /tpa
                hasKit = await hasItemInInventory(CONFIG.kitItems[0].name);
                if (!hasKit) {
                    await attemptKitLoad();
                    hasKit = await hasItemInInventory(CONFIG.kitItems[0].name);
                    if (!hasKit) {
                        const response = '&eHey! &cI couldn’t get a kit right now! &ePlease try &a?kit &eagain!';
                        bot.chat(`/msg ${currentUsername} ${response}`);
                        processingKitRequest = false;
                        requestsQueue.shift();
                        processNextRequest();
                        return;
                    }
                }

                try {
                    const response = '&eHey! I\'ve sent you a TPA request! Type &a&l/tpayes &ewithin 15s to accept!';
                    bot.chat(`/tpa ${currentUsername}`);
                    console.log(`🚀 TPA sent to ${currentUsername}`);
                    await sleep(100);
                    bot.chat(`/msg ${currentUsername} ${response}`);
                    _awaitingTeleport = true;
                    teleportTarget = currentUsername;
                    teleportTimeout = setTimeout(() => {
                        if (_awaitingTeleport) {
                            console.log(`⏰ Checking TPA timeout for ${teleportTarget}, _awaitingTeleport: ${_awaitingTeleport}`);
                            _awaitingTeleport = false;
                            if (teleportTarget) {
                                const timeoutResponse = '&eHey! You didn’t accept my TPA in 15 seconds! No worries, you can always run the command again: &a?kit';
                                bot.chat(`/msg ${teleportTarget} ${timeoutResponse}`);
                                console.log(`⏰ TPA timeout for ${teleportTarget}`);
                                setTimeout(() => {
                                    if (!killInProgress) {
                                        console.log(`🔄 Initiating /kill after TPA timeout; killInProgress: ${killInProgress}`);
                                        bot.chat('/kill');
                                        killInProgress = true;
                                    }
                                }, 100); // Kill 100ms after timeout message
                                bot.chat(`/tpacancel ${teleportTarget}`);
                                // Start cooldown when /tpacancel occurs
                                setCooldown(teleportTarget, CONFIG.kitCooldown);
                                teleportTarget = null;
                            }
                        }
                        processingKitRequest = false;
                        requestsQueue.shift();
                        processNextRequest();
                    }, 15000);
                } catch (err) {
                    console.error(`❌ Error while delivering kit for ${currentUsername}: ${err.message}`);
                    if (!killInProgress) {
                        console.log(`🔄 Initiating /kill due to error in kit delivery; killInProgress: ${killInProgress}`);
                        bot.chat('/kill');
                        killInProgress = true;
                    }
                    _awaitingTeleport = false;
                    teleportTarget = null;
                    if (teleportTimeout) {
                        clearTimeout(teleportTimeout);
                        teleportTimeout = null;
                    }
                    processingKitRequest = false;
                    requestsQueue.shift();
                    processNextRequest();
                }
            }
        } else if (command === 'cooldown') {
            const remainingCooldown = getRemainingCooldown(username);
            if (remainingCooldown > 0) {
                const response = `&eYour ?kit cooldown: &a${remainingCooldown} &esecond(s). Cooldown exists cause of spammers :(`;
                bot.chat(`/msg ${username} ${response}`);
            } else {
                const response = '&eYou have no &a?kit&e cooldown! You can request a kit now with &a?kit&e. Cooldown exists cause of spammers :(';
                bot.chat(`/msg ${username} ${response}`);
            }
        } else if (command === 'botping') {
            const ping = bot.player.ping || 0; // Fallback to 0 if ping is undefined
            const response = `&eMy current ping is: &a${ping}ms`;
            bot.chat(`/msg ${username} ${response}`);
        } else {
            switch (command) {
                case 'cf':
                case 'coinflip':
                    const result = Math.random() < 0.5 ? 'heads' : 'tails';
                    const response = `&eCoinflip result: &a${result}`;
                    setTimeout(() => {
                        bot.chat(`/msg ${username} ${response}`);
                    }, 500);
                    break;

                case 'boop':
                    const boopResponse = '&bBoop &cYeah thats it';
                    bot.chat(`/msg ${username} ${boopResponse}`); // Always respond via /msg
                    break;

                case 'help':
                    const helpMessage = '&eAvailable commands: &a?kit&f, &a?coinflip (?cf)&f, &a?boop&f, &a?kits&f, &a?stats&f, &a?hug, &a?cooldown, &a?botping  &7(these can be used in /msg as well)';
                    bot.chat(`/msg ${username} ${helpMessage}`);
                    break;

                case 'kits':
                    const kitsResponse = '&eDo &a?kit &7&o(too lazy to code multiple kits)';
                    bot.chat(`/msg ${username} ${kitsResponse}`);
                    break;

                case 'stats':
                    const statsResponse = `&eTotal Kits Delivered: &a${kitsDelivered} &eTotal Kits in Stock: &a${kitsInStock}`;
                    bot.chat(`/msg ${username} ${statsResponse}`);
                    break;

                case 'hug':
                    const hugResponse = '&cWomp Womp you aint getting any';
                    bot.chat(`/msg ${username} ${hugResponse}`);
                    break;

                default:
                    const unknownResponse = '&cUnknown command!';
                    if (isWhisper) bot.chat(`/msg ${username} ${unknownResponse}`);
                    break;
            }
        }
    }

    bot.on('message', async (msg) => {
        const text = msg.toString();

        // Handle teleport-related messages
        if (_awaitingTeleport) {
            if (/Teleporting\s*[.…]+|Teleported|Teleport\s*successful/i.test(text)) {
                console.log('✅ Teleport accepted for target:', teleportTarget);
                if (teleportTimeout) {
                    console.log(`⏰ Clearing teleportTimeout for ${teleportTarget}`);
                    clearTimeout(teleportTimeout);
                    teleportTimeout = null;
                }
                _awaitingTeleport = false;

                if (!killInProgress) {
                    const killSuccess = await executeKillWithRetry();
                    const kitStillInInventory = await hasItemInInventory(CONFIG.kitItems[0].name);
                    if (killSuccess || !kitStillInInventory) {
                        console.log(`🎁 Delivered kit to ${teleportTarget}, kitStillInInventory: ${kitStillInInventory}`);
                        hasKit = false;
                        kitsDelivered++;
                        kitsInStock--;
                        const currentCount = kitRequests.get(teleportTarget) || 0;
                        kitRequests.set(teleportTarget, currentCount + 1);
                        saveKitStats();
                        saveKitRequests();
                        setCooldown(teleportTarget, CONFIG.kitCooldown);
                        teleportTarget = null;
                    } else {
                        console.warn(`⚠️ Kill failed and kit not delivered; killSuccess: ${killSuccess}, kitStillInInventory: ${kitStillInInventory}`);
                        if (teleportTarget && kitStillInInventory) {
                            bot.chat(`/msg ${teleportTarget} &cSorry, something went wrong! &ePlease try &a?kit &eagain.`);
                        }
                        hasKit = kitStillInInventory;
                        teleportTarget = null;
                    }
                }
                processingKitRequest = false;
                requestsQueue.shift();
                return;
            } else if (/denied|cancelled|failed/i.test(text)) {
                console.warn('⚠️ Teleport failed for target:', teleportTarget);
                if (teleportTarget) {
                    bot.chat(`/msg ${teleportTarget} &cTeleport failed. &ePlease try &a?kit &eagain.`);
                }
                _awaitingTeleport = false;
                teleportTarget = null;
                if (teleportTimeout) {
                    clearTimeout(teleportTimeout);
                    teleportTimeout = null;
                }
                processingKitRequest = false;
                requestsQueue.shift();
                return;
            }
        }

        // this part is to take out the username of the player out of the < > part!
        const chatMatch = text.match(/^(?:\[.*?\]\s*)?<([^>]+)>\s*(.+)$/i);
        if (chatMatch) {
            const username = chatMatch[1].trim(); // Extract username from <username>
            const message = chatMatch[2].trim();
            const cleanMessage = message.toLowerCase();

            // Skip if the message is from the bot itself (to avoid refilling unnecessarily!)
            if (username === CONFIG.username) {
                console.log(`⚠️ Ignoring command from self: ${username}`);
                return;
            }

            if (cleanMessage.startsWith('?')) {
                await handleCommand(username, cleanMessage, false);
            }
            return;
        }

        // Handle whispers (this is optimized for anarchy servers, this MAY run into errors on regular ones)
        const whisperMatch = text.match(/^([.\w]{1,16})\s+whispers:\s*(.+)$/i);
        if (whisperMatch) {
            const username = whisperMatch[1].trim(); 
            const message = whisperMatch[2].trim();
            const cleanMessage = message.toLowerCase();

            // Skip if the whisper is from the bot itself (to avoid an infinite loop)
            if (username === CONFIG.username) {
                console.log(`⚠️ Ignoring whisper from self: ${username}`);
                return;
            }

            if (cleanMessage.startsWith('?')) {
                await handleCommand(username, cleanMessage, true);
            }
            return;
        }

        console.log('⚠️ Message did not match expected chat or whisper format');
    });

    bot.on('death', () => {
        hasDied = true;
        console.log('💀 Bot died');
    });

    bot.on('respawn', async () => {
        console.log('🔄 Bot respawned');
        hasDied = false;
        killInProgress = false;
        hasKit = await hasItemInInventory(CONFIG.kitItems[0].name);
        if (!hasKit) {
            await sleep(1000); 
            await attemptKitLoad();
        }
        hasKit = await hasItemInInventory(CONFIG.kitItems[0].name);
    });

    bot.on('end', () => {
        if (adInterval) {
            clearInterval(adInterval);
            adInterval = null;
        }
        _awaitingTeleport = false;
        teleportTarget = null;
        if (teleportTimeout) {
            clearTimeout(teleportTimeout);
            teleportTimeout = null;
        }
        processingKitRequest = false;
        requestsQueue.length = 0; // Clear queue on disconnect
        console.warn('⚠️ Disconnected, reconnecting in 10s…');
        setTimeout(startBot, 10_000);
    });

    bot.on('error', (err) => {
        console.error(`❌ Bot error: ${err.message}`);
        if (adInterval) {
            clearInterval(adInterval);
            adInterval = null;
        }
        _awaitingTeleport = false;
        teleportTarget = null;
        if (teleportTimeout) {
            clearTimeout(teleportTimeout);
            teleportTimeout = null;
        }
        processingKitRequest = false;
        requestsQueue.length = 0; // Clear queue on error
        console.warn('⚠️ Error encountered, reconnecting in 10s…');
        setTimeout(startBot, 10_000);
    });

    // Periodic cooldown cleanup
    setInterval(() => {
        const now = Date.now();
        for (const [username, cooldownEnd] of cooldownMap.entries()) {
            if (now >= cooldownEnd) {
                cooldownMap.delete(username);
            }
        }
    }, 1000);
}

startBot();

//Hit me up on github at Jay32bit if you have any issues
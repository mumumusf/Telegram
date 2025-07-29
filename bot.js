require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');

// 配置
const BOT_TOKEN = '8293450905:AAElkk3KoihHablLfYa0UdNFKLpQahaHQEY';
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '0 9 * * *'; // 默认每天上午9点

// 创建机器人实例
const bot = new TelegramBot(BOT_TOKEN, { 
    polling: {
        interval: 1000,
        autoStart: true,
        params: {
            timeout: 30
        }
    },
    request: {
        agentOptions: {
            keepAlive: true,
            family: 4
        }
    }
});

// 存储新闻数据
let newsData = [];
let isCollectingNews = false;
let currentNewsSection = '';
let currentNewsTitle = '';
let currentNewsLink = '';
let isSettingTime = false;
let currentCronSchedule = process.env.CRON_SCHEDULE || '0 9 * * *'; // 默认每天上午9点
let publishChannel = ''; // 发布频道ID
let isSettingChannel = false; // 是否正在设置发布频道

// HTML转义函数，防止特殊字符破坏HTML结构
function escapeHtml(text) {
    if (!text) return '';
    return text.toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// 安全编辑消息函数
async function safeEditMessage(chatId, messageId, text, options = {}) {
    try {
        await bot.editMessageText(text, {
            chat_id: chatId,
            message_id: messageId,
            ...options
        });
        return true;
    } catch (error) {
        // 如果是内容相同错误，直接忽略
        if (error.message.includes('message is not modified')) {
            console.log('消息内容相同，跳过编辑');
            return true;
        }
        
        // 其他错误，发送新消息
        console.log('编辑消息失败，发送新消息:', error.message);
        try {
            await bot.sendMessage(chatId, text, options);
        } catch (sendError) {
            console.error('发送新消息也失败:', sendError.message);
        }
        return false;
    }
}

// 启动消息
console.log('🤖 Telegram新闻机器人已启动');
console.log(`📅 定时发布设置: ${CRON_SCHEDULE}`);
console.log('�� 机器人已启动，等待消息...');

// 创建主菜单键盘
function createMainMenu() {
    return {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '📝 添加新闻', callback_data: 'add_news' },
                    { text: '📋 查看新闻', callback_data: 'list_news' }
                ],
                [
                    { text: '🗑️ 清空新闻', callback_data: 'clear_news' },
                    { text: '📤 立即发布', callback_data: 'publish_now' }
                ],
                [
                    { text: '❓ 帮助', callback_data: 'help' },
                    { text: '⚙️ 设置', callback_data: 'settings' }
                ]
            ]
        }
    };
}

// 创建设置菜单键盘
function createSettingsMenu() {
    return {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '🕐 设置发送时间', callback_data: 'set_time' }
                ],
                [
                    { text: '📢 设置发布频道', callback_data: 'set_channel' }
                ],
                [
                    { text: '📅 查看当前设置', callback_data: 'view_settings' }
                ],
                [
                    { text: '🔙 返回主菜单', callback_data: 'main_menu' }
                ]
            ]
        }
    };
}

// 创建时间选择键盘
function createTimeSelectionKeyboard() {
    const times = [
        ['06:00', '07:00', '08:00'],
        ['09:00', '10:00', '11:00'],
        ['12:00', '13:00', '14:00'],
        ['15:00', '16:00', '17:00'],
        ['18:00', '19:00', '20:00'],
        ['21:00', '22:00', '23:00']
    ];
    
    const keyboard = times.map(row => 
        row.map(time => ({ text: time, callback_data: `time_${time}` }))
    );
    
    keyboard.push([{ text: '🔙 返回设置', callback_data: 'settings' }]);
    
    return {
        reply_markup: {
            inline_keyboard: keyboard
        }
    };
}

// 将时间转换为cron表达式
function timeToCron(timeStr) {
    const [hour, minute] = timeStr.split(':').map(Number);
    return `${minute} ${hour} * * *`;
}

// 将cron表达式转换为可读时间
function cronToTime(cronStr) {
    const parts = cronStr.split(' ');
    const minute = parts[0];
    const hour = parts[1];
    return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
}

// 创建确认键盘
function createConfirmKeyboard(action) {
    return {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '✅ 确认', callback_data: `confirm_${action}` },
                    { text: '❌ 取消', callback_data: 'cancel' }
                ],
                [
                    { text: '🔙 返回主菜单', callback_data: 'main_menu' }
                ]
            ]
        }
    };
}

// 处理 /start 命令
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    await bot.sendMessage(chatId, 
        '👋 欢迎使用智能新闻发布机器人！\n\n' +
        '🎯 请选择您要进行的操作：',
        createMainMenu()
    );
});

// 处理回调查询（按钮点击）
bot.on('callback_query', async (query) => {
    try {
        const chatId = query.message.chat.id;
        const userId = query.from.id;
        const data = query.data;
        
        // 立即回答回调查询，避免超时
        try {
            await bot.answerCallbackQuery(query.id);
        } catch (error) {
            // 忽略超时错误，这是正常现象
            if (error.message.includes('query is too old') || error.message.includes('timeout expired')) {
                // 静默处理，不输出日志
            } else {
                console.log('回调查询回答失败:', error.message);
            }
        }
    
    switch (data) {
        case 'add_news':
            isCollectingNews = true;
            await safeEditMessage(
                chatId,
                query.message.message_id,
                '📝 开始添加新闻\n\n' +
                '请发送新闻板块：\n' +
                '💡 例如：科技、财经、体育等',
                {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔙 返回主菜单', callback_data: 'main_menu' }]
                        ]
                    }
                }
            );
            break;
            
        case 'list_news':
            if (newsData.length === 0) {
                await safeEditMessage(
                    chatId,
                    query.message.message_id,
                    '📭 暂无新闻数据',
                    {
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '🔙 返回主菜单', callback_data: 'main_menu' }]
                            ]
                        }
                    }
                );
            } else {
                // 按板块分组新闻
                const newsBySection = {};
                newsData.forEach(news => {
                    if (!newsBySection[news.section]) {
                        newsBySection[news.section] = [];
                    }
                    newsBySection[news.section].push(news);
                });
                
                let message = `📋 已添加 ${newsData.length} 条新闻：\n\n`;
                
                // 按板块组织显示
                Object.keys(newsBySection).forEach((section, sectionIndex) => {
                    message += `📌 ${section}\n`;
                    message += `${'─'.repeat(20)}\n`;
                    
                    newsBySection[section].forEach((news, newsIndex) => {
                        if (news.hasLink) {
                            message += `${newsIndex + 1}. <a href="${escapeHtml(news.link)}">📰 ${escapeHtml(news.title)}</a>\n\n`;
                        } else {
                            message += `${newsIndex + 1}. 📰 ${escapeHtml(news.title)}\n\n`;
                        }
                    });
                });
                
                await safeEditMessage(
                    chatId,
                    query.message.message_id,
                    message,
                    {
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '🔙 返回主菜单', callback_data: 'main_menu' }]
                            ]
                        }
                    }
                );
            }
            break;
            
        case 'clear_news':
            await safeEditMessage(
                chatId,
                query.message.message_id,
                '🗑️ 确定要清空所有新闻吗？\n\n' +
                `当前共有 ${newsData.length} 条新闻`,
                {
                    reply_markup: createConfirmKeyboard('clear').reply_markup
                }
            );
            break;
            
        case 'publish_now':
            await safeEditMessage(
                chatId,
                query.message.message_id,
                '📤 确定要立即发布新闻吗？\n\n' +
                `当前共有 ${newsData.length} 条新闻\n` +
                '⚠️ 发布后会自动清空所有新闻',
                {
                    reply_markup: createConfirmKeyboard('publish').reply_markup
                }
            );
            break;
            
        case 'help':
            await safeEditMessage(
                chatId,
                query.message.message_id,
                '📖 使用说明：\n\n' +
                '方法一：\n' +
                '1️⃣ 点击"添加新闻"按钮\n' +
                '2️⃣ 按提示输入新闻板块\n' +
                '3️⃣ 输入新闻标题\n' +
                '4️⃣ 输入新闻链接（如果没有链接，输入"无"）\n' +
                '5️⃣ 重复步骤2-4添加更多新闻\n' +
                '6️⃣ 输入 "完成" 结束添加\n\n' +
                '方法二：\n' +
                '直接发送：板块|标题|链接\n' +
                '例如：科技|重要新闻|https://example.com\n\n' +
                '方法三：\n' +
                '直接发送：板块|标题（无链接）\n' +
                '例如：科技|重要新闻\n\n' +
                '⏰ 机器人会在设定时间自动发布新闻汇总\n' +
                '🕐 可在"设置"中修改发送时间\n' +
                '📢 请先设置发布频道，新闻会发布到频道\n' +
                '🗑️ 发布后会自动清空新闻，为第二天做准备\n' +
                `当前定时设置：${cronToTime(currentCronSchedule)} (中国时间)`,
                {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔙 返回主菜单', callback_data: 'main_menu' }]
                        ]
                    }
                }
            );
            break;
            
        case 'settings':
            await safeEditMessage(
                chatId,
                query.message.message_id,
                '⚙️ 机器人设置\n\n' +
                `📅 定时发布：${cronToTime(currentCronSchedule)} (中国时间)\n` +
                `📢 发布频道：${publishChannel || '未设置'}\n` +
                `📊 当前新闻：${newsData.length} 条\n` +
                `🗑️ 自动清空：发布后自动清空\n\n` +
                '💡 点击下方按钮进行设置',
                {
                    reply_markup: createSettingsMenu().reply_markup
                }
            );
            break;
            
        case 'set_time':
            await safeEditMessage(
                chatId,
                query.message.message_id,
                '🕐 设置每日发送时间\n\n' +
                `当前设置：${cronToTime(currentCronSchedule)} (中国时间)\n` +
                '请选择新的发送时间：',
                {
                    reply_markup: createTimeSelectionKeyboard().reply_markup
                }
            );
            break;
            
        case 'view_settings':
            await safeEditMessage(
                chatId,
                query.message.message_id,
                '📅 当前设置详情\n\n' +
                `🕐 发送时间：${cronToTime(currentCronSchedule)} (中国时间)\n` +
                `📢 发布频道：${publishChannel || '未设置'}\n` +
                `📊 当前新闻：${newsData.length} 条\n` +
                `🗑️ 自动清空：发布后自动清空\n\n` +
                '💡 如需修改设置，请点击相应按钮',
                {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🕐 修改时间', callback_data: 'set_time' }],
                            [{ text: '📢 修改频道', callback_data: 'set_channel' }],
                            [{ text: '🔙 返回设置', callback_data: 'settings' }]
                        ]
                    }
                }
            );
            break;
            
        case 'confirm_clear':
            newsData = [];
            await safeEditMessage(
                chatId,
                query.message.message_id,
                '✅ 所有新闻已清空！',
                {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔙 返回主菜单', callback_data: 'main_menu' }]
                        ]
                    }
                }
            );
            break;
            
        case 'confirm_publish':
            await publishNews();
            await safeEditMessage(
                chatId,
                query.message.message_id,
                '✅ 新闻已发布到频道！',
                {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔙 返回主菜单', callback_data: 'main_menu' }]
                        ]
                    }
                }
            );
            break;
            
        case 'cancel':
            await safeEditMessage(
                chatId,
                query.message.message_id,
                '❌ 操作已取消',
                {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔙 返回主菜单', callback_data: 'main_menu' }]
                        ]
                    }
                }
            );
            break;
            
        case 'main_menu':
            await safeEditMessage(
                chatId,
                query.message.message_id,
                '👋 欢迎使用智能新闻发布机器人！\n\n' +
                '🎯 请选择您要进行的操作：',
                {
                    reply_markup: createMainMenu().reply_markup
                }
            );
            break;
            
        case 'time_06:00':
        case 'time_07:00':
        case 'time_08:00':
        case 'time_09:00':
        case 'time_10:00':
        case 'time_11:00':
        case 'time_12:00':
        case 'time_13:00':
        case 'time_14:00':
        case 'time_15:00':
        case 'time_16:00':
        case 'time_17:00':
        case 'time_18:00':
        case 'time_19:00':
        case 'time_20:00':
        case 'time_21:00':
        case 'time_22:00':
        case 'time_23:00':
            const selectedTime = data.replace('time_', '');
            const newCronSchedule = timeToCron(selectedTime);
            
            // 更新定时任务
            // 停止当前定时任务（如果存在）
            if (global.currentCronJob) {
                global.currentCronJob.stop();
            }
            currentCronSchedule = newCronSchedule;
            
            // 重新启动定时任务
            global.currentCronJob = cron.schedule(currentCronSchedule, async () => {
                console.log('⏰ 定时任务触发，开始发布新闻...');
                await publishNews();
            }, {
                scheduled: true,
                timezone: "Asia/Shanghai"
            });
            
            await safeEditMessage(
                chatId,
                query.message.message_id,
                `✅ 发送时间已更新！\n\n` +
                `🕐 新的发送时间：${selectedTime} (中国时间)\n` +
                `📅 Cron表达式：${newCronSchedule}\n\n` +
                '💡 机器人将在每天指定时间自动发布新闻汇总',
                {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔙 返回设置', callback_data: 'settings' }]
                        ]
                    }
                }
            );
            break;

        case 'set_channel':
            await safeEditMessage(
                chatId,
                query.message.message_id,
                '📢 设置发布频道\n\n' +
                `当前发布频道：${publishChannel || '未设置'}\n\n` +
                '请按以下步骤设置：\n' +
                '1️⃣ 创建一个Telegram频道或群组\n' +
                '2️⃣ 将机器人添加为管理员\n' +
                '3️⃣ 发送频道/群组的用户名或ID\n' +
                '   例如：@mychannel 或 -1001234567890\n\n' +
                '💡 设置后新闻汇总会发布到该频道',
                {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔙 返回设置', callback_data: 'settings' }]
                        ]
                    }
                }
            );
            // 设置状态，等待用户输入频道信息
            isSettingChannel = true;
            break;
    }
    } catch (error) {
        console.error('❌ 回调查询处理错误:', error.message);
        // 尝试发送错误消息给用户
        try {
            await bot.sendMessage(query.message.chat.id, '❌ 处理请求时发生错误，请稍后重试');
        } catch (sendError) {
            console.error('❌ 发送错误消息失败:', sendError.message);
        }
    }
});

// 处理文本消息
bot.on('message', async (msg) => {
    try {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const text = msg.text;
        
        // 检查text是否存在（避免undefined错误）
        if (!text) return;
        
        // 跳过命令消息
        if (text.startsWith('/')) return;
    
    // 如果正在设置频道
    if (isSettingChannel) {
        publishChannel = text.trim();
        isSettingChannel = false;
        
        await bot.sendMessage(chatId, 
            `✅ 发布频道已设置！\n\n` +
            `📢 频道：${publishChannel}\n\n` +
            '💡 新闻汇总将发布到此频道',
            createMainMenu()
        );
        return;
    }
    
    // 检查是否是 "板块|标题|链接" 格式
    if (text.includes('|')) {
        const parts = text.split('|');
        if (parts.length === 3) {
            const section = parts[0].trim();
            const title = parts[1].trim();
            const link = parts[2].trim();
            
            if (isValidUrl(link)) {
                newsData.push({
                    section: section,
                    title: title,
                    link: link,
                    hasLink: true,
                    timestamp: new Date().toISOString(),
                    addedBy: userId
                });
                
                await bot.sendMessage(chatId, 
                    `✅ 新闻已添加：\n📌 板块：${section}\n📰 标题：${title}\n🔗 链接：${link}`,
                    {
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '🔙 返回主菜单', callback_data: 'main_menu' }]
                            ]
                        }
                    }
                );
                return;
            } else {
                await bot.sendMessage(chatId, '❌ 链接格式不正确，请使用：板块|标题|链接');
                return;
            }
        } else if (parts.length === 2) {
            // 只有板块和标题，没有链接
            const section = parts[0].trim();
            const title = parts[1].trim();
            
            newsData.push({
                section: section,
                title: title,
                link: '',
                hasLink: false,
                timestamp: new Date().toISOString(),
                addedBy: userId
            });
            
            await bot.sendMessage(chatId, 
                `✅ 新闻已添加：\n📌 板块：${section}\n📰 标题：${title}\n💡 无链接`,
                {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔙 返回主菜单', callback_data: 'main_menu' }]
                        ]
                    }
                }
            );
            return;
        }
    }
    
    // 如果正在收集新闻
    if (isCollectingNews) {
        if (text === '完成' || text === 'done') {
            isCollectingNews = false;
            await bot.sendMessage(chatId, 
                `✅ 新闻收集完成！共添加了 ${newsData.length} 条新闻\n\n` +
                '📅 新闻将在设定时间自动发布并保存到日志文件',
                createMainMenu()
            );
            return;
        }
        
        if (!currentNewsSection) {
            currentNewsSection = text;
            await bot.sendMessage(chatId, 
                `📌 板块已设置：${text}\n\n📰 请发送新闻标题：`
            );
        } else if (!currentNewsTitle) {
            currentNewsTitle = text;
            await bot.sendMessage(chatId, 
                `📰 标题已设置：${text}\n\n🔗 请发送新闻链接（如果没有链接，请输入"无"）：`
            );
        } else if (!currentNewsLink) {
            currentNewsLink = text;
            
            // 检查是否有链接
            if (text === '无' || text === 'none' || text === '') {
                // 没有链接的新闻
                newsData.push({
                    section: currentNewsSection,
                    title: currentNewsTitle,
                    link: '',
                    hasLink: false,
                    timestamp: new Date().toISOString(),
                    addedBy: userId
                });
                
                await bot.sendMessage(chatId, 
                    `✅ 新闻已添加：\n📌 板块：${currentNewsSection}\n📰 标题：${currentNewsTitle}\n💡 无链接\n\n` +
                    '请继续发送下一条新闻的板块，或输入 "完成" 结束添加'
                );
            } else {
                // 验证链接格式
                if (!isValidUrl(currentNewsLink)) {
                    await bot.sendMessage(chatId, '❌ 链接格式不正确，请重新输入：');
                    currentNewsLink = '';
                    return;
                }
                
                // 保存新闻
                newsData.push({
                    section: currentNewsSection,
                    title: currentNewsTitle,
                    link: currentNewsLink,
                    hasLink: true,
                    timestamp: new Date().toISOString(),
                    addedBy: userId
                });
                
                await bot.sendMessage(chatId, 
                    `✅ 新闻已添加：\n📌 板块：${currentNewsSection}\n📰 标题：${currentNewsTitle}\n🔗 链接：${currentNewsLink}\n\n` +
                    '请继续发送下一条新闻的板块，或输入 "完成" 结束添加'
                );
            }
            
            // 重置当前新闻
            currentNewsSection = '';
            currentNewsTitle = '';
            currentNewsLink = '';
        }
    }
    } catch (error) {
        console.error('❌ 文本消息处理错误:', error.message);
        // 尝试发送错误消息给用户
        try {
            await bot.sendMessage(msg.chat.id, '❌ 处理消息时发生错误，请稍后重试');
        } catch (sendError) {
            console.error('❌ 发送错误消息失败:', sendError.message);
        }
    }
});

// 验证URL格式
function isValidUrl(string) {
    try {
        new URL(string);
        return true;
    } catch (_) {
        return false;
    }
}

// 发布新闻函数
async function publishNews() {
    if (newsData.length === 0) {
        console.log('📭 没有新闻可发布');
        return;
    }
    
    try {
        const currentDate = new Date().toLocaleDateString('zh-CN');
        const currentTime = new Date().toLocaleTimeString('zh-CN');
        
        // 按板块分组新闻
        const newsBySection = {};
        newsData.forEach(news => {
            if (!newsBySection[news.section]) {
                newsBySection[news.section] = [];
            }
            newsBySection[news.section].push(news);
        });
        
        let message = `Searching Alpha - Daily Digest 讓你熱點不漏接！${currentDate}\n\n`;
        
        // 按板块组织新闻
        Object.keys(newsBySection).forEach((section, index) => {
            message += `📌 ${section}\n`;
            message += `${'─'.repeat(20)}\n`;
            
            newsBySection[section].forEach((news, newsIndex) => {
                if (news.hasLink) {
                    message += `${newsIndex + 1}. <a href="${escapeHtml(news.link)}">📰 ${escapeHtml(news.title)}</a>\n\n`;
                } else {
                    message += `${newsIndex + 1}. 📰 ${escapeHtml(news.title)}\n\n`;
                }
            });
        });
        
        message += `📊 共 ${Object.keys(newsBySection).length} 个板块，${newsData.length} 条新闻`;
        
        // 发送到频道
        try {
            if (publishChannel) {
                // 发送到设置的频道
                await bot.sendMessage(publishChannel, message, {
                    parse_mode: 'HTML',
                    disable_web_page_preview: true
                });
                console.log(`✅ 新闻汇总已发送到频道: ${publishChannel}`);
            } else {
                console.log('💡 未设置发布频道，请先设置发布频道');
            }
            
            // 在控制台显示
            console.log('\n' + '='.repeat(50));
            console.log(`Searching Alpha - Daily Digest - ${currentDate} ${currentTime}`);
            console.log('='.repeat(50));
            console.log(message);
            console.log('='.repeat(50));
            
        } catch (error) {
            console.error('❌ 发送到频道失败:', error.message);
            console.log('💡 请检查频道设置和机器人权限');
        }
        
        // 清空已发布的新闻，为第二天做准备
        const publishedCount = newsData.length;
        newsData = [];
        console.log(`🗑️ 已清空 ${publishedCount} 条新闻，准备收集新的新闻`);
        
    } catch (error) {
        console.error('❌ 发布新闻时出错:', error.message);
    }
}

// 设置定时任务
global.currentCronJob = cron.schedule(CRON_SCHEDULE, async () => {
    console.log('⏰ 定时任务触发，开始发布新闻...');
    await publishNews();
}, {
    scheduled: true,
    timezone: "Asia/Shanghai"
});

// 错误处理
bot.on('polling_error', (error) => {
    // 忽略常见的网络错误，避免日志污染
    if (error.code === 'EFATAL' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
        console.log('🌐 网络连接问题，等待重连...');
        return;
    }
    
    // 其他错误记录但继续运行
    console.error('❌ 轮询错误:', error.message || error);
});

bot.on('error', (error) => {
    // 记录错误但不退出
    console.error('❌ 机器人错误:', error.message || error);
});

// 优雅关闭
process.on('SIGINT', () => {
    console.log('\n🛑 正在关闭机器人...');
    bot.stopPolling();
    process.exit(0);
}); 
const options = require("./options.js")
const Telegraf = require('telegraf')
const captureWebsite = require('capture-website')
const createCollage = require("@settlin/collage")
const fs = require('fs')
const { resolve } = require("path")

const BOT_TOKEN = options.telegram.API_KEY;
const PORT = 5005;

let collageOptions = {
    sources: [],
    width: 5,
    height: 4,
    imageWidth: 536,
    imageHeight: 338,
    spacing: 0,
};

/*
    TODO:

    No 2 caps of same team
    Check which teams turn, show remaining attempts
        Prevent user of another team to select card
        When captain gives tip, turn begins with attempts = number + 1
        On mistake, turn ends
        After first attempt, show "End turn" button
    Save game and commands on restart (lowdb?)
    
*/

const bot = new Telegraf(BOT_TOKEN);

async function generateImage(source, chat_id, isKey = false) {
    let imgDir = './web/imgs/',
        imgSaveDir = "./games/" + chat_id + "/",
        newSource = [];

    source.forEach(pic => {
        switch (pic) {
            case "b":
                newSource.push(imgDir + "roles/blue.jpg");
                break;
            case "r":
                newSource.push(imgDir + "roles/red.jpg");
                break;
            case "k":
                newSource.push(imgDir + "roles/killer.jpg");
                break;
            case "n":
                newSource.push(imgDir + "roles/neutral.jpg");
                break;
            default:
                newSource.push(`${imgDir}${pic}.png`);
                break;
        }
    })

    imgSaveDir += (isKey) ? "key.png" : "game.png";

    collageOptions.sources = newSource;

    await new Promise((resolve, reject) => {
        createCollage(collageOptions).then((canvas) => {
            const stream = fs.createWriteStream(imgSaveDir);
            canvas.jpegStream().pipe(stream)
            stream.on('finish', () => {
                resolve();
            });
        })
    })
}

function getRandomNums(amount, from) {
    let nums = [];
    for (let i = 0; i <= from; i++) nums.push(i);
    let shuffled = nums.sort(() => 0.5 - Math.random());
    return shuffled.slice(0, amount);
}

let games = {},
    teams = {};

function generateGame() {
    let game = {
        firstTeam: (Math.round(Math.random())) ? "r" : "b",
        cur: getRandomNums(20, 278),
        key: [
            "b", "b", "b", "b", "b",
            "b", "b", "r", "r", "r",
            "r", "r", "r", "r", "k",
            "n", "n", "n", "n"
        ],
        captains: {},
        turn: {
            team: "",
            attempts: ""
        },
    };
    game.key.push(game.firstTeam);
    game.key.sort(() => 0.5 - Math.random());
    return game;
}

function updateGame(game_id, pos) {
    let curGame = games[game_id];
    if (!curGame) return;
    curGame.cur[pos] = curGame.key[pos];
}

async function startGame(chat_id) {

    chat_id += "";
    // chat_id = chat_id.replace(/[^\w\s]/gi, '');

    games[chat_id] = generateGame();

    let path = "games/" + chat_id + "/";

    if (!fs.existsSync(path)) fs.mkdirSync(path);

    return await new Promise((resolve, reject) => {
        generateImage(games[chat_id].cur, chat_id)
        .then(() => {
            generateImage(games[chat_id].key, chat_id, true)
            .then(resolve);
        })
    })
}

function picSelectMenu(chat_id) {
    let curKey = games[chat_id].cur;
    let keyboard = [];
    for (let i = 0; i < 20; i++) {
        let obj = {
            text: '🏞',
            callback_data: 'pic_select ' + i
        }
        if (curKey[i] == "b") obj.text = '🟦';
        if (curKey[i] == "r") obj.text = '🟥';
        if (curKey[i] == "n") obj.text = '🟨';
        if (curKey[i] == "k") obj.text = '⬛️';
        if (curKey[i] == "b" || curKey[i] == "r" || curKey[i] == "n" || curKey[i] == "k") obj.callback_data = "empty_select";

        keyboard.push(obj);
    }

    return Telegraf.Extra
        .markdown()
        .markup((m) => m.inlineKeyboard(keyboard, {
            columns: 5
        }));
}

function joinTeam(team, userData, chat_id) {
    let oppositeTeam = "red";
    if (team != "blue") {
        team = "red";
        oppositeTeam = "blue";
    };
    if (!teams[chat_id]) teams[chat_id] = {
        red: {},
        blue: {}
    };
    if (teams[chat_id][oppositeTeam][userData.id]) delete teams[chat_id][oppositeTeam][userData.id];
    teams[chat_id][team][userData.id] = {
        // id: userData.id,
        name: userData.first_name + " " + userData.last_name,
        login: userData.username
    }
}

function getUserTeam(user_id, chat_id) {
    if (!teams[chat_id]) return false;
    if (teams[chat_id].blue && teams[chat_id].blue[user_id])
        return "blue";
    else if (teams[chat_id].red && teams[chat_id].red[user_id])
        return "red";
    else
        return false;
}

function isCaptain(user_id, chat_id) {
    return games[chat_id] && games[chat_id].captains[user_id];
}

const teamSelectMenu = Telegraf.Extra
    .markdown()
    .markup((m) => m.inlineKeyboard([{
                text: '🔵',
                callback_data: 'team_select blue'
            },
            {
                text: '🔴',
                callback_data: 'team_select red'
            },
        ], {
            columns: 2
        })
        .oneTime()
        .resize());

bot
    .start((ctx) => ctx.reply('Bot started!'))
    .command('game',
        (ctx) => {
            let chat_id = ctx.update.message.chat.id;
            startGame(chat_id)
                .then(() => {
                    if (!games[chat_id]) return;
                    ctx.replyWithPhoto({
                        source: 'games/' + chat_id + '/game.png'
                    }).then(() => {
                        let cWord = (games[chat_id].firstTeam == "b") ? "СИНЯЯ" : "КРАСНАЯ",
                            cEmoji = (games[chat_id].firstTeam == "b") ? "🟦" : "🟥";
                        games[chat_id].turn.team = (games[chat_id].firstTeam == "b") ? "blue" : "red";
                        games[chat_id].turn.attempts = 0;
                        ctx.reply(cEmoji + cEmoji + cEmoji + ' Первой ходит ' + cWord + " КОМАНДА " + cEmoji + cEmoji + cEmoji);
                        ctx.reply('Выберите картинку:', picSelectMenu(chat_id))
                    })
                })
                .catch(e => {
                    console.log(e)
                })
        })
    .command('key',
        (ctx) => {
            let chat_id = ctx.update.message.chat.id,
                user_name = ctx.update.message.from.first_name + " " + ctx.update.message.from.last_name,
                user_id = ctx.update.message.from.id;
            if (!games[chat_id]) {
                ctx.reply("Игра не найдена");
                return;
            }
            if (Object.keys(games[chat_id].captains).length < 2) {
                bot.telegram.sendMediaGroup(user_id, [
                    { type: "photo", media: { source: 'games/' + chat_id + '/game.png' } },
                    { type: "photo", media: { source: 'games/' + chat_id + '/key.png' } },
                ])
                // bot.telegram.sendPhoto(user_id, {
                //         source: 'games/' + chat_id + '/game.png'
                //     },
                //     "Hello"
                // )
                // bot.telegram.sendPhoto(user_id, {
                //         source: 'games/' + chat_id + '/key.png'
                //     },
                //     "Hello"
                // )
                .then(() => {
                    if (!games[chat_id].captains[user_id]) ctx.reply(user_name + ' становится капитаном!');
                    games[chat_id].captains[user_id] = user_name;
                })
            } else {
                ctx.reply("Уже выбрано 2 капитана: " + Object.values(games[chat_id].captains).join(" и "));
            }
        })
    .command('captains',
        (ctx) => {
            let chat_id = ctx.update.message.chat.id;
            if (!games[chat_id]) {
                ctx.reply("Игра не найдена");
                return;
            }
            ctx.reply("Капитаны: " + Object.values(games[chat_id].captains).join(" и "));
        })
    .command('teams',
        (ctx) => {
            let chat_id = ctx.update.message.chat.id;
            if (!teams[chat_id]) {
                ctx.reply("Команды не созданы");
                return;
            }
            let msg = "▫️▫️▫ КОМАНДЫ ▫️▫️▫️";
            for (let user_id in teams[chat_id].blue) {
                let data = teams[chat_id].blue[user_id],
                    isCap = (games[chat_id] && games[chat_id].captains[user_id]);
                msg += `\n🔵 ${data.name.replace(/(\w+) (\w+)/,"$1")} (@${data.login})${(isCap)?"👑":""}`;
            }
            for (let user_id in teams[chat_id].red) {
                let data = teams[chat_id].red[user_id],
                    isCap = (games[chat_id] && games[chat_id].captains[user_id]);
                msg += `\n🔴 ${data.name.replace(/(\w+) (\w+)/,"$1")} (@${data.login})${(isCap)?"👑":""}`;
            }

            ctx.reply(msg);
        })
    .command('team',
        (ctx) => {
            ctx.reply('Выберите команду:', teamSelectMenu)
        })
    .action(/^pic_select .+/, (ctx) => {
        let chat_id = ctx.update.callback_query.message.chat.id,
            user_id = ctx.update.callback_query.from.id,
            user_data = null,
            selectedID = parseInt(ctx.match[0].replace("pic_select ", "")),
            x = selectedID % 5 + 1,
            y = Math.ceil((1 + selectedID) / 5);
        if (!games[chat_id]) return;
        if (!games[chat_id].turn.attempts) {
            //turn ended
            ctx.reply('У вашей команды не осталось попыток!');
            return;
        } else if (!teams[chat_id] || !(teams[chat_id].blue[user_id] || teams[chat_id].red[user_id])) {
            ctx.reply('Чтобы выбирать картинки, нужно быть в чьей-то команде');
            return;
        } else {
            if (teams[chat_id].blue[user_id]) {
                user_data = teams[chat_id].blue[user_id];
                user_data.team = "blue";
            } else {
                user_data = teams[chat_id].red[user_id]
                user_data.team = "red";
            }
        }
        games[chat_id].turn.attempts--;
        ctx.editMessageText(`${(user_data.team == "blue")?"🔵":"🔴"} ${user_data.name} выбирает ${y} ряд, ${x} слева. Осталось попыток: ${games[chat_id].turn.attempts}`);
        updateGame(chat_id, selectedID);
        generateImage(games[chat_id].cur, chat_id)
            .then(() => {
                ctx.replyWithPhoto({
                    source: 'games/' + chat_id + '/game.png'
                }).then((res) => {
                    // ctx.pinChatMessage(chat_id, res.message_id);
                    ctx.reply('Выберите картинку:', picSelectMenu(chat_id));
                })
                .catch(() => {
                    ctx.reply('Что-то сломалось');
                })
            })
            .catch(e => {
                console.log(e)
            })

    })
    .action(/^team_select .+/, (ctx) => {
        let chat_id = ctx.update.callback_query.message.chat.id,
            team = (ctx.match[0].replace("team_select ", "")),
            user_data = ctx.update.callback_query.from,
            user_name = user_data.first_name + " " + user_data.last_name;
        joinTeam(team, user_data, chat_id);
        ctx.editMessageText(`${(team == "blue")?"🔵":"🔴"} ${user_name} теперь в ${(team == "blue")?"СИНЕЙ":"КРАСНОЙ"} КОМАНДЕ`);
    })
    .hears(/^[\W]+ [0-8]$/, (ctx) => {
        let chat_id = ctx.update.message.chat.id,
            user_id = ctx.update.message.from.id,
            user_team = getUserTeam(user_id, chat_id),
            tip = ctx.update.message.text;
        //game created, user is captain, user is joined team, team has no tip for this turn (attempts == 0)
        if (!games[chat_id] || !isCaptain(user_id, chat_id) ||
            !user_team /* || !(games[chat_id].turn.team == user_team) ||
            games[chat_id].turn.attempts > 0 */) return;

        games[chat_id].turn.attempts = parseInt(tip.replace(/.+ (\d)$/, "$1")) + 1;
        ctx.deleteMessage(ctx.update.message.message_id);
        let tips_amount = Math.max(games[chat_id].turn.attempts-1, 0),
            text_word = (tips_amount == 1)?"слово":(tips_amount > 5)?"слов":"слова";
        ctx.reply(`${(user_team == "blue")?"🔵":"🔴"} ${teams[chat_id][user_team][user_id].name} связал ${tips_amount} ${text_word} ассоциацией \n${tip.replace(/[0-8]$/, "").toUpperCase()}`);

    })
    .launch()
    .catch(e => {
        console.log(e);
        console.log("============================================");
        console.log("Ну вот, все сломалось");
    });
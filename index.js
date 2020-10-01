const options = require("./options.js")
const Telegraf = require('telegraf')
const createCollage = require("@settlin/collage")
const fs = require('fs')

const low = require('lowdb')
const FileSync = require('lowdb/adapters/FileSync')
const adapter = new FileSync('db.json')
const db = low(adapter)

db.defaults({ games: {}, teams: {} }).write()

const BOT_TOKEN = options.telegram.API_KEY;

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
        On mistake, turn ends
        After first attempt, show "End turn" button
    
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

function generateGame() {
    let firstTeam = (Math.round(Math.random())) ? "r" : "b",
        game = {
        cur: getRandomNums(20, 278),
        key: [
            "b", "b", "b", "b", "b",
            "b", "b", "r", "r", "r",
            "r", "r", "r", "r", "k",
            "n", "n", "n", "n"
        ],
        firstTeam: (firstTeam == "b")?"blue":"red",
        captains: {},
        turn: {
            team: (firstTeam == "b")?"blue":"red",
            attempts: 0
        },
    };
    game.key.push(firstTeam);
    game.key.sort(() => 0.5 - Math.random());
    return game;
}

function updateGame(chat_id, pos) {
    let newElem = db.get(`games.${chat_id}.key[${pos}]`).value(),
        teamTurn = db.get(`games.${chat_id}.turn.team`).value(),
        result = {
            isCorrect: null,
            winner: false,
            info: null,
        };
    db.set(`games.${chat_id}.cur[${pos}]`, newElem).write()
    if(newElem != teamTurn[0]) {
        db.set(`games.${chat_id}.turn.attempts`, 0).write()
        db.set(`games.${chat_id}.turn.team`, (teamTurn == "blue")?"red":"blue").write()
        result.isCorrect = false;
        switch (newElem) {
            case "n":
                result.info = "neutral"; break;
            case "r":
                result.info = "red"; break;
            case "b":
                result.info = "blue"; break;
            case "k":
                result.winner = (teamTurn == "blue")?"red":"blue";
                result.info = "killer"; 
                return result;
        }
    } else {
        db.update(`games.${chat_id}.turn.attempts`, n => n - 1).write()
        result.isCorrect = true;
    }
    result.winner = checkEndGame(chat_id);

    return result;
}

function checkEndGame(chat_id) {
    let game = db.get(`games.${chat_id}`).value(),
        blue = red = 0;

    game.cur.forEach(elem => {
        if(elem == "b") blue++;
        if(elem == "r") red++;
    })
    
    if((game.firstTeam == "red" && red == 8) || (game.firstTeam != "red" && red == 7)) 
        return "red"
    else if((game.firstTeam == "blue" && blue == 8) || (game.firstTeam != "blue" && blue == 7)) 
        return "blue"
    else 
        return false;
}

async function startGame(chat_id) {

    chat_id += "";
    db.set('games.'+chat_id, generateGame()).write();

    let path = "games/" + chat_id + "/";

    if (!fs.existsSync(path)) fs.mkdirSync(path);

    return await Promise.all([
        new Promise((resolve, reject) => { generateImage(db.get(`games.${chat_id}.cur`).value(), chat_id).then(resolve) }),
        new Promise((resolve, reject) => { generateImage(db.get(`games.${chat_id}.key`).value(), chat_id, true).then(resolve) })
    ])
}

function picSelectMenu(chat_id) {
    let curKey = db.get(`games.${chat_id}.cur`).value();
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
    if (!db.get('teams.' + chat_id).value()) {
        db.set('teams.' + chat_id, {
            red: {},
            blue: {}
        })
        .write()
    }
    db.unset(`teams.${chat_id}.${oppositeTeam}.${userData.id}`)
    .write()

    db.set(`teams.${chat_id}.${team}.${userData.id}` , {
        name: userData.first_name + " " + userData.last_name,
        login: userData.username
    })
    .write()
}

function getUserTeam(user_id, chat_id) {
    if (db.get(`teams.${chat_id}.blue.${user_id}`).value())
        return "blue";
    else if (db.get(`teams.${chat_id}.red.${user_id}`).value())
        return "red";
    else
        return false;
}

function isCaptain(user_id, chat_id) {
    return !!db.get(`games.${chat_id}.captains.${user_id}`).value();
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
                    if (!db.get(`games.${chat_id}`).value()) return;
                    ctx.replyWithPhoto({
                        source: 'games/' + chat_id + '/game.png'
                    }).then(() => {
                        if(db.get(`games.${chat_id}.turn.team`).value() == "blue") {
                            ctx.reply("🟦🟦🟦 Первой ходит СИНЯЯ КОМАНДА 🟦🟦🟦");
                        } else {
                            ctx.reply("🟥🟥🟥 Первой ходит КРАСНАЯ КОМАНДА 🟥🟥🟥");
                        }
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
            if (!db.get(`games.${chat_id}`).value()) {
                ctx.reply("Игра не найдена");
                return;
            }
            if (!getUserTeam(user_id, chat_id)) {
                ctx.reply("Чтобы стать капитаном, нужно сначала выбрать команду");
                return;
            }
            let captains = db.get(`games.${chat_id}.captains`).value();
            if (!captains || Object.keys(captains).length < 2) {
                bot.telegram.sendMediaGroup(user_id, [
                    { type: "photo", media: { source: 'games/' + chat_id + '/game.png' } },
                    { type: "photo", media: { source: 'games/' + chat_id + '/key.png' } },
                ])
                .then(() => {
                    if (!db.get(`games.${chat_id}.captains.${user_id}`).value()) {
                        db.set(`games.${chat_id}.captains.${user_id}`, user_name).write();
                        ctx.reply(user_name + ' становится капитаном!');
                    }
                })
                .catch(e => {
                    console.log(e);
                })
            } else {
                ctx.reply("Уже выбрано 2 капитана: " + Object.values(captains).join(" и "));
            }
        })
    .command('captains',
        (ctx) => {
            let chat_id = ctx.update.message.chat.id;
            if (!db.get(`games.${chat_id}`).value()) {
                ctx.reply("Игра не найдена");
                return;
            }
            ctx.reply("Капитаны: " + Object.values(db.get(`games.${chat_id}.captains`).value()).join(" и "));
        })
    .command('teams',
        (ctx) => {
            let chat_id = ctx.update.message.chat.id;
            if (!db.get(`teams.${chat_id}`).value()) {
                ctx.reply("Команды не созданы");
                return;
            }
            let msg = "▫️▫️▫ КОМАНДЫ ▫️▫️▫️",
                team = db.get(`teams.${chat_id}.blue`).value();
            for (let user_id in team) {
                let data = team[user_id];
                msg += `\n🔵 ${data.name.replace(/(\w+) (\w+)/,"$1")} (@${data.login})${(isCaptain(user_id, chat_id))?"👑":""}`;
            }

                team = db.get(`teams.${chat_id}.red`).value();
            for (let user_id in team) {
                let data = team[user_id];
                msg += `\n🔴 ${data.name.replace(/(\w+) (\w+)/,"$1")} (@${data.login})${(isCaptain(user_id, chat_id))?"👑":""}`;
            }

            ctx.reply(msg, {disable_notification: true});
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
        if (!db.get(`games.${chat_id}`).value()) return;
        if (db.get(`games.${chat_id}.turn.attempts`).value() < 1) {
            //turn ended
            ctx.reply('У вашей команды нет попыток!');
            return;
        } else if (!getUserTeam(user_id, chat_id)) {
            ctx.reply('Чтобы выбирать картинки, нужно быть в чьей-то команде');
            return;
        } else {
            let user_team = getUserTeam(user_id, chat_id);
            user_data = db.get(`teams.${chat_id}.${user_team}.${user_id}`).value();
            user_data.team = user_team;
        }

        ctx.editMessageText(`${(user_data.team == "blue")?"🔵":"🔴"} ${user_data.name} выбирает ${y} ряд, ${x} слева. Осталось попыток: ${db.get(`games.${chat_id}.turn.attempts`).value()}`);
        let gameState = updateGame(chat_id, selectedID);
        generateImage(db.get(`games.${chat_id}.cur`).value(), chat_id)
            .then(() => {
                ctx.replyWithPhoto({
                    source: 'games/' + chat_id + '/game.png'
                }).then((res) => {
                    // ctx.pinChatMessage(chat_id, res.message_id - 1);
                    if(gameState.winner) {
                        ctx.reply(`${(gameState.winner == "blue")?"🟦 СИНЯЯ":"🟥 КРАСНАЯ"} КОМАНДА одерживает победу! ${(gameState.winner == "blue")?"🟦":"🟥"}`);
                        db.unset(`games.${chat_id}`).write();
                    } else {
                        if(!gameState.isCorrect)
                            ctx.reply(`Команда допустила ошибку, ход переходит другой команде!`);
                        ctx.reply('Выберите картинку:', picSelectMenu(chat_id));
                    }
                })
                .catch(() => {
                    console.log(gameState);
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
            user_data = ctx.update.message.from,
            user_name = user_data.first_name + " " + user_data.last_name,
            user_team = getUserTeam(user_id, chat_id),
            tip = ctx.update.message.text;
        //game created, user is captain, user is joined team, team has no tip for this turn (attempts == 0)
        // if (!games[chat_id] || !isCaptain(user_id, chat_id) ||
        //     !user_team /* || !(games[chat_id].turn.team == user_team) ||
        //     games[chat_id].turn.attempts > 0 */) return;

        ctx.deleteMessage(ctx.update.message.message_id)
            .catch(e => console.log("Bot is not admin"));
        let tips_amount = parseInt(tip.replace(/.+ (\d)$/, "$1")),
            text_word = (tips_amount == 1)?"слово":(tips_amount > 5)?"слова":"слов";
        db.set(`games.${chat_id}.turn.attempts`, tips_amount + 1).write();
        ctx.reply(`${(user_team == "blue")?"🔵":"🔴"} ${user_name} связал ${tips_amount} ${text_word} ассоциацией \n${tip.replace(/[0-8]$/, "").toUpperCase()}`);
    })
    .launch()
    .catch(e => {
        console.log(e);
        console.log("============================================");
        console.log("Ну вот, все сломалось");
    });
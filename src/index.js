import * as dotenv from 'dotenv'
import { TelegramChatBot } from './telegramBot.js';
import { Database } from './database.js';
import * as web3Auth from './web3Auth.js';
import { Logger } from './logger.js';

dotenv.config()


var logger = new Logger('debug');

const { mongodbUrl, friendexbot_token, bInLocal } = process.env

const mongodb = new Database(mongodbUrl, logger);
await mongodb.init();

const telegramBot = new TelegramChatBot(friendexbot_token, mongodb, logger, bInLocal == '1');
telegramBot.startListen();
//telegramBot.sendMsgToUser(721373352, 'Total supply of Key(https://www.friend.tech/rooms/0xc9f2e8a00e76689e14ba91aac97f8d6c4d6cd657): 32.');


web3Auth.setDB(mongodb);
web3Auth.setTgBot(telegramBot);
web3Auth.setLogger(logger);

await web3Auth.monitorKeyAmount();
await web3Auth.monitorAddBotStrategyEvent();
await web3Auth.syncAllTodoProxyAccounts();
web3Auth.exeAllTodoProxyAccount();




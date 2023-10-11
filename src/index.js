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

web3Auth.setDB(mongodb);
web3Auth.setTgBot(telegramBot);
web3Auth.setLogger(logger);

await web3Auth.monitorKeyAmount();
await web3Auth.monitorAddBotStrategyEvent();
await web3Auth.syncAllTodoProxyAccounts();
web3Auth.exeAllTodoProxyAccount();




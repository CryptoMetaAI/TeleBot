import { MongoClient } from 'mongodb';
import * as dotenv from 'dotenv';

export class Database {
    constructor(mongodbUrl, logger) {
        this.mongodbUrl = mongodbUrl;
        this.logger = logger;
    }

    async init() {
        this.client = new MongoClient(this.mongodbUrl);
        await this.client.connect();
        console.log("Connected to MongoDB");
        this.mongodbo = this.client.db("friendEx");
        this.tgLocalAccount = this.mongodbo.collection("tgLocalAccount");  // tgId, local account addr, index(0/1/2)
        this.strategyExeRecord = this.mongodbo.collection("strategyExeRecord");
        this.tgProxyAccount = this.mongodbo.collection("tgProxyAccount");
        //this.proxyAccounts = this.mongodbo.collection('porxyAccount');  // proxy account
        //this.baseInfo = this.mongodbo.collection('baseInfo');  // base info: chainId, contractAddr, event, last sync block number
    }

    async insertTGLocalAccount(telegramId, localAccount, index) {
        await this.tgLocalAccount.insertOne({telegramId, localAccount, index});
    }

    async addProxyAccounts(proxyAccounts) {
        const newProxyAccounts = []
        for (let i = 0; i < proxyAccounts.length; i++) {
            const exist = await this.isProxyAccountExist(proxyAccounts[i]);
            if (!exist) {
                await this.insertProxyAccount(proxyAccounts[i]);
                newProxyAccounts.push(proxyAccounts[i]);
            }
        }
        return newProxyAccounts;
    }

    async getLocalAccountInfo(searchKey) {
        const result = this.tgLocalAccount.find(searchKey);
        return result.toArray();
    }

    async insertTgProxyAccount(telegramId, proxyAccount) {
        await this.tgProxyAccount.insertOne({telegramId, proxyAccount});
    }

    async removeTgProxyAccount(telegramId, proxyAccount) {
        await this.tgProxyAccount.deleteOne({telegramId, proxyAccount});
    }

    async getTgProxyAccountInfo(searchKey) {
        const proxyAccounts = this.tgProxyAccount.find(searchKey);
        return proxyAccounts.toArray();
    }

    async getAllProxyAccounts(telegramId) {
        const proxyAccounts = this.tgProxyAccount.find({telegramId});
        return proxyAccounts.toArray();
    }

    async isTgProxyAccountExist(telegramId, proxyAccount) {
        const result = await this.tgProxyAccount.findOne({telegramId, proxyAccount});
        return result != null;
    }

    async insertStrategyExeRecords(strategyExeRecords) {
        await this.strategyExeRecord.insertMany(strategyExeRecords);
    }

    async insertOrUpdateBaseInfo(chainId, contractAddr, event, lastBlockNumber) {
        await this.baseInfo.updateOne(
            { chainId, contractAddr, event },
            { $set: lastBlockNumber },
            { upsert: true }
        );
    }

    async getLastBlockNumber(chainId, contractAddr, event) {
        const result = await this.baseInfo.findOne({chainId, contractAddr, event});
        return result;
    }

    async getAllSocialEnableIds() {
        const result = await this.socialEnableCol.find();
        return result.toArray();
    }

    async insertOrUpdateLanguageSetting(telegramId, languageSetting) {
        await this.languageSettingCol.updateOne(
            { telegramId },
            { $set: languageSetting },
            { upsert: true }
        );
    }

    async getLanguageSetting(telegramId) {
        const result = await this.languageSettingCol.findOne({ telegramId });
        return result;
    }

    async insertOrUpdateSystemRoleSetting(telegramId, systemRoleInfo) {
        await this.systemRoleCol.updateOne(
            { telegramId },
            { $set: { systemRoleInfo } },
            { upsert: true }
        );
    }

    async getSystemRoleSetting(telegramId) {
        const result = await this.systemRoleCol.findOne({ telegramId });
        return result;
    }

    async insertOrUpdateSpeed(telegramId, speed) {
        await this.speedSettingCol.updateOne(
            { telegramId },
            { $set: { speed } },
            { upsert: true }
        );
    }

    async getSpeed(telegramId) {
        const result = await this.speedSettingCol.findOne({ telegramId });
        return result;
    }


    async insertOrUpdateGPTVersion(telegramId, gptVersion) {
        await this.gptVersionCol.updateOne(
            { telegramId },
            { $set: { gptVersion } },
            { upsert: true }
        );
    }

    async getGPTVersion(telegramId) {
        const result = await this.gptVersionCol.findOne({ telegramId });
        return result == null ? null : result.gptVersion;
    }

    async getSomeoneCountOfOneDay(telegramId, date) {
        const result = await this.dialogCol.countDocuments({telegramId, date: getCurDate(date)});
        return result;
    }   
    
    async getAllDataOfOneWeek(date) {
        const week = getWeek(date);
        const cursor = await this.dialogCol.find({week});
        const result = await cursor.toArray();
        return result;
    }
    
    async getSomeOneDataOfOneMonth(telegramId, date, language) {
        const curMonth = getMonth(date);
        const queryCondtion = ({telegramId, month: curMonth});
        if (language != null) {
            queryCondtion.language = language;
        }
        const cursor = await this.dialogCol.find(queryCondtion);
        const result = await cursor.toArray();
        return result;
    }

    async getSomeOneDataOfTwoMonths(telegramId, date) {
        const curMonth = getMonth(date);
        const lastMonth = getMonth(new Date(date.getTime() - 3600 * 24 * 30 * 1000));
        const cursor = await this.dialogCol.find({telegramId, $or: [{month: curMonth}, {month: lastMonth}]});
        const result = await cursor.toArray();
        return result;
    }

    async getAllTelegramId() {
        const telegramIds = await this.dialogCol.distinct('telegramId');
        return telegramIds;
    }

    async getAllPrompts() {
        const result = await this.promptCol.find();
        return result.toArray();
    }

    async createEnsureIndexOfPrompt() {
        await this.promptCol.createIndex({prompt: 'text'});
    }

    async searchPrompts(keywords) {
        keywords = keywords.split(' ');
        let searchInfo = ""
        keywords.map(keyword => {
            keyword = keyword.trim();
            searchInfo += `\"${keyword}\" `
        })
        console.log(searchInfo);
        const result = await this.promptCol.find({$text: {$search: searchInfo}}).toArray();
        return result;
    }

    async insertOrUpdatePrompt(prompt) {
        await this.promptCol.updateOne(
            { _id: prompt._id },
            { $set: prompt },
            { upsert: true }
        );
    }

    async getUserUsage(telegramId) {
        const result = await this.usageStatCol.findOne({ telegramId });
        return result == null ? null : result.usage;
    }

    async insertOrUpdateUsage(telegramId, usage) {
        await this.usageStatCol.updateOne(
            { telegramId },
            { $set: { usage } },
            { upsert: true }
        );
    }
}

const test = async () => {
    dotenv.config();
    const { mongodbUrl } = process.env;
    console.log(mongodbUrl);
    const mongodb = new Database(mongodbUrl);
    await mongodb.init();
    
    await mongodb.insertTGLocalAccount('111', 'text', '0');
    await mongodb.insertTGLocalAccount('111', 'text1', '1');
    await mongodb.insertTGLocalAccount('111', 'text2', '1');
    
    
    //console.log(await mongodb.getLocalAccountInfo({localAccount: 'text'}));
    console.log(await mongodb.getLocalAccountInfo({telegramId: "111"}));
}

const testGetTelegramIds = async () => {
    dotenv.config();
    const { mongodbUrl } = process.env;
    console.log(mongodbUrl);
    const mongodb = new Database(mongodbUrl);
    await mongodb.init();

    const telegramIds = await mongodb.getAllTelegramId();
    console.log(telegramIds.length);
    telegramIds.map(telegramId => {
        mongodb.getSomeOneDataOfOneMonth(telegramId, new Date()).then(dialogs => {
            if (dialogs.length > 10)
                console.log(telegramId, dialogs.length);
            // dialogs.map(dialog => {
            //     console.log('  ', dialog.prompt);
            // })
        })
    })
}

const testCreateIndex4Prompts = async () => {
    dotenv.config();
    const { mongodbUrl } = process.env;
    console.log(mongodbUrl);
    const mongodb = new Database(mongodbUrl);
    await mongodb.init();

    await mongodb.createEnsureIndexOfPrompt();
}

const testSearchPrompts = async (keyword) => {
    dotenv.config();
    const { mongodbUrl } = process.env;
    console.log(mongodbUrl);
    const mongodb = new Database(mongodbUrl);
    await mongodb.init();

    const result = await mongodb.searchPrompts(keyword);
    console.log(result);
}

const testUsage = async (telegramId, model, promptTokens, completionTokens, cost) => {
    dotenv.config();
    const { mongodbUrl } = process.env;
    const mongodb = new Database(mongodbUrl);
    await mongodb.init();

    let usage = await mongodb.getUserUsage(telegramId);
    console.log(usage, '\n\n');

    if (usage != null) {
        if (usage[model] != null) {
            usage[model].promptTokens += promptTokens;
            usage[model].completionTokens += completionTokens;
            usage[model].totalCost += cost;
        } else {
            usage[model] = {
                promptTokens,
                completionTokens,
                totalCost: cost
            }
        }
    } else {
        usage = {}
        usage[model] = {
            promptTokens,
            completionTokens,
            totalCost: cost
        }
    }

    await mongodb.insertOrUpdateUsage(telegramId, usage);

    console.log(await mongodb.getUserUsage(telegramId));
}

// test();
// testGetTelegramIds();
// testCreateIndex4Prompts();
// testSearchPrompts("english teacher");

// testUsage('1234', 'gpt-4', 100, 101, 1);

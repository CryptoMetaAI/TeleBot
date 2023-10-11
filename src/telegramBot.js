import TelegramBot from 'node-telegram-bot-api';
import * as web3Auth from './web3Auth.js';
import fs from 'fs';

export class TelegramChatBot {
    constructor(friendexbot_token, mongodb, logger, bInLocal) {
        if (bInLocal) {
          this.bot = new TelegramBot(friendexbot_token, { polling: true, request: { proxy: "socks5://127.0.0.1:7890" }});
        } else {
          this.bot = new TelegramBot(friendexbot_token, { polling: true });
        }
        this.logger = logger;
        this.logger.info('--Bot has been started...');
        this.mongodb = mongodb;
    }

    getNativeBot() {
        return this.bot;
    }

    async startListen() {
        this.startListenText();
    }

    async generateLocalAccounts(msg, number) {
        let localAddresses = [];
        const tgId = web3Auth.getTelegramId(msg.from.id);
        const localAccounts = await this.mongodb.getLocalAccountInfo({telegramId: tgId});
        if (localAccounts.length > 0) {
          localAddresses = localAccounts.map(la => la.localAccount);
          return localAddresses;
        }
        while(number > 0) {
          const address = web3Auth.getUserAccount(tgId, number).address;
          localAddresses.push(address);
          await this.mongodb.insertTGLocalAccount(tgId, address, number);
          number--;
        }
        return localAddresses;
    }

    async addTgProxyAccount(msg, paAddrs) {
      const tgId = web3Auth.getTelegramId(msg.from.id);
      for (let i = 0; i < paAddrs.length; i++) {
        const exist = await this.mongodb.isTgProxyAccountExist(tgId, paAddrs[i]);
        if (!exist) {
          await this.mongodb.insertTgProxyAccount(tgId, paAddrs[i]);
        }
      }
    }

    async delTgProxyAccount(msg, paAddrs) {
      const tgId = web3Auth.getTelegramId(msg.from.id);
      for (let i = 0; i < paAddrs.length; i++) {
        const exist = await this.mongodb.isTgProxyAccountExist(tgId, paAddrs[i]);
        if (exist) {
          await this.mongodb.removeTgProxyAccount(tgId, paAddrs[i]);
        }
      }
    }

    async getAllTgProxyAccounts(msg) {
      const tgId = web3Auth.getTelegramId(msg.from.id);
      return await this.mongodb.getAllProxyAccounts(tgId);
    }

    async getAccountsBalance(msg) {
        const localAddresses = await this.generateLocalAccounts(msg, 3);
        const accountsBalanceInfo = await web3Auth.getAccountBalances(localAddresses, true);
        return accountsBalanceInfo;
    }

    async startListenText() {
        this.bot.on('text', async (msg) => {
            if (msg.text && msg.text.match(/ETELEGRAM: 403 Forbidden/)) {
              this.logger.debug(`User ${msg.chat.id} has blocked the bot`);
              return;
            }
          
            this.logger.info('--Received message from id:', msg.chat.id, msg.text);  
            msg.type = 'text';
            await this.msgHandler(msg);
        });
    }

    async msgHandler(msg) {
        switch (true) {
          case msg.text.startsWith('/start'):
            const addresses = await this.generateLocalAccounts(msg, 3);
            await this.bot.sendMessage(msg.chat.id, 
              `Hello, I'm the robot that can help you automatically execute your strategies.These strategies are the ones you've configured for buying or selling Keys on https://friendex.world.I'll monitor blockchain data 24/7 and execute your strategies for you.
               \n[您好，我是可以帮您自动运行策略的机器人，这些策略是您在friendex.world上配置好的购买或销售Key的策略， 我会帮您24小时监控区块链上的数据，并为您执行策略]`);
            await this.bot.sendMessage(msg.chat.id, 
              `Below are three accounts I've generated for you. You need to set up these accounts as the operator of the ProxyAccount on the friendex.world website and top them up with a certain amount of ETH (balance >= 0.005 ETH) as a gas fee for me to execute your strategies automatically.
              \n[以下是我为您生成的三个账号，您需要在friendex.world网站上将这些账号设置为ProxyAccount的Operator,并为它们充值一定数量的ETH(余额必须大于等于0.005ETH)作为gas fee，我才能够自动执行您的策略]`);
            await this.bot.sendMessage(msg.chat.id, `${addresses[0]}\n\n${addresses[1]}\n\n${addresses[2]}`);
            break;
          case msg.text.startsWith('/balances'):
            const accountsBalanceInfo = await this.getAccountsBalance(msg);
            await this.bot.sendMessage(msg.chat.id, `${accountsBalanceInfo[0].account}: ${accountsBalanceInfo[0].balance}\n\n${accountsBalanceInfo[1].account}: ${accountsBalanceInfo[1].balance}\n\n${accountsBalanceInfo[2].account}: ${accountsBalanceInfo[2].balance}`);
            break;          
          case msg.text.startsWith('/addproxyaccounts'):
            const paAddrs = msg.text.substring('/addproxyaccounts'.length).trim().split(/[ ,]+/);
            if (paAddrs.length == 0 || paAddrs[0] == '') {
              await this.bot.sendMessage(msg.chat.id, `The correct command is: /addproxyaccounts 0x111... 0x222...`);
            } else {
              const invalidAddrs = web3Auth.checkAddress(paAddrs);
              if (invalidAddrs.length > 0) {
                await this.bot.sendMessage(msg.chat.id, `There are invalid addresses: ${JSON.stringify(invalidAddrs)}`);
              } else {
                await this.addTgProxyAccount(msg, paAddrs);
                await this.bot.sendMessage(msg.chat.id, `Success to add proxy accounts`);
              }
            }
            break;
          case msg.text.startsWith('/delproxyaccounts'):
            const delPaAddrs = msg.text.substring('/delproxyaccounts'.length).trim().split(/[ ,]+/);
            if (delPaAddrs.length == 0 || delPaAddrs[0] == '') {
              await this.bot.sendMessage(msg.chat.id, `There correct command is: /delproxyaccounts 0x111... 0x222...`);
            } else {
              const invalidDelAddrs = web3Auth.checkAddress(delPaAddrs);
              if (invalidDelAddrs.length > 0) {
                await this.bot.sendMessage(msg.chat.id, `There are invalid addresses: ${JSON.stringify(invalidDelAddrs)}`);
              } else {
                await this.delTgProxyAccount(msg, delPaAddrs);
                await this.bot.sendMessage(msg.chat.id, `Success to delete proxy accounts`);
              }
            }
            break;
          
          case msg.text.startsWith('/listproxyaccounts'):
            const allProxyAccounts = await this.getAllTgProxyAccounts(msg);
            await this.bot.sendMessage(msg.chat.id, `All proxy accounts: ${JSON.stringify(allProxyAccounts.map(proxyAccount => proxyAccount.proxyAccount))}`);
            break;
          case msg.text.startsWith('/addbotaccount'):
            await this.bot.sendMessage(msg.chat.id, 'This functionality will be coming soon.');
            break;  
          case msg.text.startsWith('/strategyinfo'):
            await this.bot.sendMessage(msg.chat.id, 'This functionality will be coming soon.');
            break; 
          
          case msg.text.startsWith('/addmonitor'):
            const monitor = JSON.parse(msg.text.substring('/addmonitor'.length).trim());            
            monitor.chatId = msg.chat.id;
            await this.mongodb.insertMonitor(monitor);
            await this.bot.sendMessage(msg.chat.id, 'Success to add the monitor.');
            break; 
            
          case msg.text.startsWith('/delmonitor'):
            const monitorId = parseInt(msg.text.substring('/delmonitor'.length).trim());
            const monitors = await this.mongodb.getMonitorsOfOneUser({id: monitorId, chatId: msg.chat.id});
            if (monitors.length != 1) {
              await this.bot.sendMessage(msg.chat.id, `Please input the correct id: ${monitorId}, ${monitors.length}`);            
            } else {
              await this.mongodb.removeMonitor(msg.chat.id, monitorId);
              await this.bot.sendMessage(msg.chat.id, 'Success to delete the monitor.');            
            }
            break;  


          case msg.text.startsWith('/listmonitors'):
            const myMonitors = await this.mongodb.getMonitorsOfOneUser({chatId: msg.chat.id});
            await this.bot.sendMessage(msg.chat.id, `Your ${myMonitors.length} monitors: ${JSON.stringify(myMonitors)}`);
            break; 

          case msg.text.startsWith('/help'):
            await this.bot.sendMessage(msg.chat.id, 'Command List[命令列表]:\
                                                   \n/balances - get balances of accounts [获取账户余额]\
                                                   \n\n/addproxyaccounts - add proxy accounts which are split by space or comma. [增加代理账号]\
                                                   \n\n/delproxyaccounts - del proxy accounts [移除代理账号]\
                                                   \n\n/listproxyaccounts - show all proxy accounts [查看所有代理账号]\
                                                   \n\n/addbotaccount - add bot account [增加机器人账号]');
            break;
          default:
            await this.bot.sendMessage(msg.chat.id, `😭I don't quite understand what you mean. [我不是很明白您的意思。]`);
            break;
        }
    }    
    
    async setMsgToUser(chatId, msg) {
      await this.bot.sendMessage(chatId, msg);
    }
}
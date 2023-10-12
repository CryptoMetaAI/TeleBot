import Web3 from "web3";
import * as dotenv from 'dotenv';
import abi from 'ethereumjs-abi';
import { recoverPersonalSignature } from 'eth-sig-util';
import { mnemonicToAccount, english, generateMnemonic } from 'viem/accounts'
import { createWalletClient, parseGwei, parseEther } from 'viem'
import { createPublicClient, http, encodeEventTopics, decodeEventLog, isAddress } from 'viem'
import { baseGoerli, base } from 'viem/chains';
import BotStrategy from './contracts/BotStrategy.json' assert { type: 'json' };
import ProxyAccount from './contracts/ProxyAccount.json' assert { type: 'json' };
import FriendtechSharesV1 from './contracts/FriendtechSharesV1.json' assert { type: 'json' };
import ProxyAccountFactory from './contracts/ProxyAccountFactory.json' assert { type: 'json' };
import BigNumber from "bignumber.js";

dotenv.config()

const HARDENED_OFFSET = 0x80000000;
const web3 = new Web3();
const { mnemonic, alchemyBaseGoerliKey, alchemyBaseMainnetKey, baseMainnet } = process.env;

let database;
let logger;
let telegramBot;
let allTodoProxyAccounts = []
const proxyAccountExeStat = {}
const localAccountInExecuting = {}
let monitorMap = {}

const transport = baseMainnet == "1" ? http(`https://base-mainnet.g.alchemy.com/v2/${alchemyBaseMainnetKey}`)
                                        :
                                       http(`https://base-goerli.g.alchemy.com/v2/${alchemyBaseGoerliKey}`)
// 
const publicClient = createPublicClient({
  chain: baseMainnet == "1" ?  base : baseGoerli,
  transport,
})

const walletClient = createWalletClient({
    chain: baseMainnet == "1" ? base : baseGoerli,
    transport
})

export function getTelegramId(userName) {
    const buf = Buffer.from('' + userName, 'utf8');
    const hex = '0x' + buf.toString('hex');
    const telegramId = web3.utils.sha3(hex);
    return BigInt(telegramId) & BigInt(HARDENED_OFFSET - 1);
}

export function setDB(db) {
    database = db;
}

export function setTgBot(tgBot) {
    telegramBot = tgBot;
}

export function setLogger(logger_) {
    logger = logger_;
}

export function getUserAccount(tgId, index) {
    const account = mnemonicToAccount(
        mnemonic,
        {
            accountIndex: tgId,
            addressIndex: index
        }
    )
    return account;
}

export function checkAddress(addrs) {
    const invalidAddrs = addrs.map(addr => {
        if (!isAddress(addr)) return addr;
    }).filter(addr => addr != null)
    return invalidAddrs;
}

export async function getAccountBalances(accounts, bReadable) {
    const accountBalances = []
    for (let i = 0; i < accounts.length; i++) {
        const balance = await publicClient.getBalance({ 
            address: accounts[i],
        })
        if (bReadable) {
            accountBalances.push({account: accounts[i], balance: new BigNumber(balance).shiftedBy(-18).toFixed(4) + ' ETH'});
        } else {
            accountBalances.push({account: accounts[i], balance});
        }
        
    }
    return accountBalances; 
}

export async function monitorAddBotStrategyEvent() {
    const contractAddr = BotStrategy.address[publicClient.chain.name];
    const eventName = 'AddStrategy';
    publicClient.watchContractEvent({ 
        address: contractAddr,
        abi: BotStrategy.abi,
        eventName,
        onLogs: logs => {
            // logger.debug(logs)
            const proxyAccount = logs[0].args.proxyAccount;
            const paSet = new Set(allTodoProxyAccounts);
            if (!paSet.has(proxyAccount)) {
                allTodoProxyAccounts.push(proxyAccount);
            }
            if (proxyAccountExeStat[proxyAccount] == null) {
                exeProxyAccountInLoop(proxyAccount);
            }
        }
    })
}

export async function monitorKeyAmount() {
    setInterval(async () => {
        const lastNum = Object.keys(monitorMap).length;
        const allMonitors = await database.getAllMonitors();
        monitorMap = {}
        allMonitors.forEach(monitor => monitorMap[monitor.kolAddr.toLowerCase()] = monitor);
        if (Object.keys(monitorMap).length != lastNum) {
            logger.info(`total monitor number:${allMonitors.length}`)
        }
    }, 3000);
        
    const contractAddr = FriendtechSharesV1.address[publicClient.chain.name];
    const eventName = 'Trade';
    publicClient.watchContractEvent({ 
        address: contractAddr,
        abi: FriendtechSharesV1.abi,
        eventName,
        onLogs: logs => {
            logs.forEach(log => {
                const kolAddr = log.args.subject.toLowerCase();
                const supply = log.args.supply;
                logger.debug(`${kolAddr}(total key = ${supply}): ${logs[0].args.isBuy ? 'buy' : 'sell'} ${logs[0].args.shareAmount}`)
                if (monitorMap[kolAddr] != null) {
                    const monitor = monitorMap[kolAddr];
                    logger.debug(`${kolAddr} enter: ${monitor.chainId == publicClient.chain.id} && ${supply >= monitor.triggerCondition.keyFrom} && ${supply < monitor.triggerCondition.keyTo}`)
                    if (monitor.chainId == publicClient.chain.id 
                    && supply >= monitor.triggerCondition.keyFrom 
                    && supply < monitor.triggerCondition.keyTo) {
                        const msg = `Total Key of ${monitor.twitterId}(https://www.friend.tech/rooms/${monitor.kolAddr}): ${supply}.`;
                        logger.info(`${monitor.chatId}: ${msg}`)
                        telegramBot.sendMsgToUser(monitor.chatId, msg);
                    }
                }
            })
        }
    })
}

export async function syncAllTodoProxyAccounts() {
    const number = await publicClient.readContract({
        address: BotStrategy.address[publicClient.chain.name],
        abi: BotStrategy.abi,
        functionName: 'totalToDoProxyAccountNumber',
    })
    const pageSize = 20;
    for (let i = 0; i < number; i += pageSize) {
        const endIndex = i + pageSize > number ? number : i + pageSize;
        const proxyAccounts = await publicClient.readContract({
            address: BotStrategy.address[publicClient.chain.name],
            abi: BotStrategy.abi,
            functionName: 'getAllToDoProxyAccounts',
            args: [i, endIndex]
        })
        allTodoProxyAccounts = [...allTodoProxyAccounts, ...proxyAccounts]
    }
    logger.info('total proxy accounts number', number, allTodoProxyAccounts)
}

export async function exeProxyAccountInLoop(proxyAccount) {
    if (proxyAccountExeStat[proxyAccount] == 'running') return;

    const tgProxyAccountInfo = await database.getTgProxyAccountInfo({proxyAccount});
    if (tgProxyAccountInfo.length == 0) {
        proxyAccountExeStat[proxyAccount] = 'noReg';
        logger.info(proxyAccount + ' has NOT been added.')   
        setTimeout(() => exeProxyAccountInLoop(proxyAccount), 3000);         
        return;
    }

    const telegramId = tgProxyAccountInfo[0].telegramId;
    const localAccountInfos = await database.getLocalAccountInfo({telegramId});
    let selectableLocalAccounts = [];
    for (let i = 0; i < localAccountInfos.length; i++) {    
        const localAddress = localAccountInfos[i].localAccount;
        if (localAccountInExecuting[localAddress]) continue;

        const balance = await publicClient.getBalance({ 
            address: localAddress,
        })
        if (new BigNumber(balance).gte(new BigNumber('0.005').shiftedBy(18))) {
            selectableLocalAccounts.push(localAccountInfos[i]);
        }
    }
    if (selectableLocalAccounts.length == 0) {
        proxyAccountExeStat[proxyAccount] = 'noLocalAccount';
        logger.warn('There is no valid local account to execute the proxy account.')   
        setTimeout(() => exeProxyAccountInLoop(proxyAccount), 3000);         
        return;
    }
    
    proxyAccountExeStat[proxyAccount] = 'running';
    publicClient.readContract({
        address: proxyAccount,
        abi: ProxyAccount.abi,
        functionName: 'getAllStrategyEntryPoints',
    }).then(async (allBots) => {
        const executableBots = []
        for (let i = 0; i < allBots.length; i++) {
            const executableSIds = await publicClient.readContract({
                address: allBots[i],
                abi: BotStrategy.abi,
                functionName: 'checkStrategy',
                args: [proxyAccount]
            })
            if (executableSIds.length > 0) {
                executableBots.push({bot: allBots[i], executableSIds});
            }
        }
        if (executableBots.length == 0) {
            proxyAccountExeStat[proxyAccount] = 'finish';
            logger.debug(proxyAccount + ' has no valid strategy to execute.')
            setTimeout(() => exeProxyAccountInLoop(proxyAccount), 3000);
            return;
        }
        const accountSlot = {}
        let accountIndex = 0;
        for (let i = 0; i < executableBots.length; i++) {
            if (accountSlot[accountIndex] == null) {
                accountSlot[accountIndex] = [i];
            } else {
                accountSlot[accountIndex].push(i);
            }
            accountIndex++;
            if (accountIndex == selectableLocalAccounts.length) accountIndex = 0;
        }
        logger.info('accountSlot', JSON.stringify(accountSlot));
        let executeBotCount = 0;        
        Object.keys(accountSlot).forEach(async (accIndex) => {
            try {
                const botIndexes = accountSlot[accIndex];
                const account = getUserAccount(selectableLocalAccounts[accIndex].telegramId, selectableLocalAccounts[accIndex].index);
                localAccountInExecuting[selectableLocalAccounts[accIndex].localAccount] = true;
                for (let i = 0; i < botIndexes.length; i++) {
                    const botIndex = botIndexes[i];
                    const botInfo = executableBots[botIndex];
                    logger.info(`Bot account(${account.address}) execute strategy for proxy account(${proxyAccount}) according to strategy(${botInfo.bot})`)
                    const hash = await walletClient.writeContract({
                        account,
                        address: botInfo.bot,
                        abi: BotStrategy.abi,
                        functionName: 'executeStrategy',
                        args: [proxyAccount, botInfo.executableSIds],
                    })
                    logger.info(`Tx(${hash}) has been sent out.`)
                    publicClient.waitForTransactionReceipt({ hash }).then(receipt => {
                        executeBotCount++;
                        if (executeBotCount == executableBots.length)
                            proxyAccountExeStat[proxyAccount] = 'finish';
                        logger.info(`Tx(${hash}) has been confirmed.`)
                        logger.debug(JSON.stringify(receipt, (key, value) =>
                            typeof value === 'bigint'
                                ? value.toString()
                                : value // return everything else unchanged
                        ))
                        const topic = encodeEventTopics({
                            abi: BotStrategy.abi,
                            eventName: 'ExecuteStrategy'
                        })[0];
                        const exeRecords = receipt.logs.map(log => { 
                            if (log.topics[0] != topic) return;

                            const topics = decodeEventLog({
                                abi: BotStrategy.abi,
                                data: log.data,
                                topics: encodeEventTopics({
                                    abi: BotStrategy.abi,
                                    eventName: 'ExecuteStrategy'
                                })
                            })
                            
                            topics.args.botContract = receipt.to;
                            topics.args.hash = hash;
                            topics.args.proxyAccount = '0x' + new BigNumber(log.topics[1]).toString(16);
                            topics.args.sharesSubject = '0x' + new BigNumber(log.topics[2]).toString(16);
                            return topics.args;
                        }).filter(record => record != null)
                        database.insertStrategyExeRecords(exeRecords);
                        setTimeout(() => exeProxyAccountInLoop(proxyAccount), 3000);
                    })                
                }
                localAccountInExecuting[selectableLocalAccounts[accIndex].localAccount] = false;
            } catch (error) {
                logger.error(error.message);
                executeBotCount++;
                if (executeBotCount == executableBots.length)
                    proxyAccountExeStat[proxyAccount] = 'finish';
                localAccountInExecuting[selectableLocalAccounts[accIndex].localAccount] = false;
            }
        })
    })
}

export function exeAllTodoProxyAccount() {
    allTodoProxyAccounts.map(todoProxyAccount => {
        exeProxyAccountInLoop(todoProxyAccount);
 })
}


// const buf = Buffer.from('100', 'utf8');
// const hex = buf.toString('hex');
// console.log(hex);

// console.log(web3.utils.sha3('100'));

// console.log(web3.utils.keccak256('100'));

//console.log(abi.solidityPack(['bytes32', 'address'], ['0x8c18210df0d9514f2d2e5d8ca7c100978219ee80d3968ad850ab5ead208287b3', '0x5B38Da6a701c568545dCfcB03FcB875f56beddC4']).toString('hex'))
//console.log(abi.rawEncode(['string', 'address'], ['0x8c18210df0d9514f2d2e5d8ca7c100978219ee80d3968ad850ab5ead208287b3', '0x5B38Da6a701c568545dCfcB03FcB875f56beddC4']).toString('hex'))
//console.log(web3.utils.keccak256("0x8c18210df0d9514f2d2e5d8ca7c100978219ee80d3968ad850ab5ead208287b35b38da6a701c568545dcfcb03fcb875f56beddc4"))

// console.log(web3.eth.accounts.privateKeyToAccount(privateKey).address);

// const signature = sign('0x313030', "0x5B38Da6a701c568545dCfcB03FcB875f56beddC4");

// console.log(signature);

// const buf = Buffer.from("\x19Ethereum Signed Message:\n32", 'utf8');
// const hex = '0x' + buf.toString('hex');
// console.log(hex);

// const encoded = abi.solidityPack(['bytes', 'bytes32', 'address'], [buf, signature.telegramId, "0x5B38Da6a701c568545dCfcB03FcB875f56beddC4"]).toString('hex');
// let messageHash = web3.utils.soliditySha3(encoded);
// console.log(messageHash)
// console.log(web3.eth.accounts.recover(messageHash, signature.v, signature.r, signature.s, true));
//console.log(web3.eth.accounts.recover(signature.messageHash, signature, true));

// const tgId = getTelegramId('syslink')

// const account = getUserAccount(tgId, 0)
// console.log(account)

// const signature = await account.signTransaction({
//     maxFeePerGas: parseGwei('20'),
//     maxPriorityFeePerGas: parseGwei('3'),
//     gas: 21000n,
//     nonce: 0,
//     to: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
//     value: parseEther('1'), 
//     chainId: 1
//   })

// console.log(signature)

// console.log(await getAccountBalances(['0x177CfCD9286B30D27122e9b308140E14Bc353a05', '0xe2D09de8ff38C38aB943b957E1fEDf4E4192Ed82']))
// console.log(await getAccountBalances(['0x177CfCD9286B30D27122e9b308140E14Bc353a05', '0xe2D09de8ff38C38aB943b957E1fEDf4E4192Ed82'], true))

//console.log(getUserAccount(72872807, 2).address);
//console.log(generateMnemonic(english))




import Web3 from "web3";
import * as dotenv from 'dotenv';
import { Logger } from './logger.js';
import { Database } from './database.js';
import { createPublicClient, http, encodeEventTopics, decodeEventLog, isAddress } from 'viem'
import { baseGoerli, base } from 'viem/chains';
import BotStrategy from './contracts/BotStrategy.json' assert { type: 'json' };
import ProxyAccount from './contracts/ProxyAccount.json' assert { type: 'json' };
import FriendtechSharesV1 from './contracts/FriendtechSharesV1.json' assert { type: 'json' };
import ProxyAccountFactory from './contracts/ProxyAccountFactory.json' assert { type: 'json' };
import BigNumber from "bignumber.js";
import userInfo from '../assets/userinfo.json' assert { type: 'json' };
import ftInfo from '../assets/ftInfo.json' assert { type: 'json' };

dotenv.config()

const HARDENED_OFFSET = 0x80000000;
const web3 = new Web3();
const { mnemonic, alchemyBaseGoerliKey, alchemyBaseMainnetKey, baseMainnet, mongodbUrl } = process.env;

var logger = new Logger('debug');

const database = new Database(mongodbUrl, logger);
await database.init();

const transport = baseMainnet == "1" ? http(`https://base-mainnet.g.alchemy.com/v2/${alchemyBaseMainnetKey}`)
                                        :
                                       http(`https://base-goerli.g.alchemy.com/v2/${alchemyBaseGoerliKey}`)
// 
const publicClient = createPublicClient({
  chain: baseMainnet == "1" ?  base : baseGoerli,
  transport,
})

export function monitorAddBotStrategyEvent() {
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

const processUserInfo = () => {
    const addrUrlPrefix = 'https://dune.com/ramaha/friendtech-subject-review?subject=';
    const xUrlPrefix = 'https://twitterscore.io/twitter/';
    const xUrlSuffix = '/overview/';
    const result = userInfo.data.get_execution.execution_succeeded.data.map(v => {
        let address;
        let twitterId;
        let fromIndex = v.subject.indexOf(addrUrlPrefix);
        if (fromIndex > -1) {
            address = v.subject.substr(fromIndex + addrUrlPrefix.length, 42)
        }
        if (v.Twitter != null) {
            fromIndex = v.Twitter.indexOf(xUrlPrefix);
            let endIndex = v.Twitter.indexOf(xUrlSuffix);
            if (fromIndex > -1) {
                twitterId = v.Twitter.substr(fromIndex + xUrlPrefix.length, endIndex - fromIndex - xUrlPrefix.length)
            }
            if (address != null && twitterId != null)
                return {address, twitterId, price: v.key_price}
        }
    }).filter(v => v != null).sort((a, b) => b.price - a.price)
    logger.info(JSON.stringify(result))
}

// console.log('start to delete same value');
// const deletedData = await database.deleteFtRowsWithSameValue('address')
// console.log(deletedData);

const syncFtdata = async () => {
    logger.info('start sync all addresses of subjects');
    const addressArr = await database.getAllValueInFt('address');
    logger.info('address arr number:', addressArr.length)

    const addressSet = new Set(addressArr)

    //logger.info('address set number:', addressSet.has('0x0Ab83E0Cf97f30Fd939Fb6C2a00B53154Dd79E14'), addressSet.has('0xfd7232e66a69e1ae01e1e0ea8fab4776e2d325a9'))


    let fromBlock = 2498440;
    const step = 1000;
    const curBlock = await publicClient.getBlockNumber();
    logger.info('sync ft data:', fromBlock, ' ~ ', curBlock)

    while (fromBlock < curBlock) {
        const filter = await publicClient.createContractEventFilter({
            abi: FriendtechSharesV1.abi,
            address: FriendtechSharesV1.address[publicClient.chain.name],
            eventName: 'Trade',
            fromBlock, 
            toBlock: fromBlock + step > curBlock ? curBlock : fromBlock + step
        })
        const logs = await publicClient.getFilterLogs({ filter })
        let loggedSubjects = logs.map(log => {
            return log.args.supply == 1 ? log.args.subject : null;
        }).filter(v => v != null)

        const subjects = loggedSubjects.filter(subject => {
            if (!addressSet.has(subject.toLowerCase())) {
                //logger.debug('not inserted subject:', subject)
                addressSet.add(subject.toLowerCase());
                return subject;
            } else {
                //logger.debug('inserted subject:', subject)
                return null;
            }
        }).filter(v => v != null)

        logger.info(fromBlock, '~', fromBlock + step, ' => ', subjects.length + ' new subjects / ' + loggedSubjects.length + ' logged subjects')
        if (subjects.length == 0) {
            fromBlock += step;
            continue;
        }

        const urlsToFetch = subjects.map(subject => 'https://prod-api.kosetto.com/users/' + subject);
        try {
            const promises = urlsToFetch.map(url => fetch(url));
            // 等待所有网络请求完成
            const responses = await Promise.all(promises);
            const successfulResponses = responses.filter((response, index) => {
                if (response.status === 200) return true;

                logger.debug(JSON.stringify(response), urlsToFetch[index]);
                return false;
            });
            
            if (successfulResponses.length > 0) {
                const subjectInfos = await Promise.all(successfulResponses.map(response => response.json()));            
                logger.debug(subjectInfos)

                database.insertFtSubjectInfos(subjectInfos)
                logger.info('success insert data:' + subjectInfos.length)
            } else {
                logger.warn('there is no success response')
            }
        } catch (error) {
            logger.error('fail to get data: ', fromBlock, '~', fromBlock + step)
            logger.error(error.message)
        }
        fromBlock += step;
    }
    
}


const getAddressTwitterId = async () => {
    logger.info('start sync all addresses and twitter ids of subjects');
    const userInfoArr = await database.getPartialFtSubjectInfo('address', 'twitterUsername', 'shareSupply');
    const sortedInfoArr = userInfoArr.sort((a, b) => b.shareSupply - a.shareSupply);

    logger.info(JSON.stringify(sortedInfoArr))

}

const twitterId2Addr = {}
ftInfo.forEach(v => twitterId2Addr[v.twitterUsername] = v.address);
logger.info(JSON.stringify(twitterId2Addr))
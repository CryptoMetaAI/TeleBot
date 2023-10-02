import Web3 from "web3";
import * as dotenv from 'dotenv';
import abi from 'ethereumjs-abi';
import { recoverPersonalSignature } from 'eth-sig-util';
import { mnemonicToAccount } from 'viem/accounts'
import { createWalletClient, parseGwei, parseEther } from 'viem'
import { createPublicClient, http, encodeEventTopics, decodeEventLog, isAddress } from 'viem'
import { baseGoerli, base } from 'viem/chains'
import BotStrategy from './contracts/BotStrategy.json' assert { type: 'json' };
import ProxyAccount from './contracts/ProxyAccount.json' assert { type: 'json' };
import ProxyAccountFactory from './contracts/ProxyAccountFactory.json' assert { type: 'json' };
import BigNumber from "bignumber.js";

export class AccountBot {
    constructor(tgId, index) {
       
    }

    async checkBalance() {

    }
}
// const EVMChain = require('./EVMChain');

import { EVMChain } from './EVMChain'
const Web3 = require('web3');

export class NetworkCenter {
    constructor() {
        this.networkProvider = {
            1: {'https': 'https://mainnet.infura.io/v3/e95c3e3d2d81441a8552117699ffa5bd', 'wss': 'wss://mainnet.infura.io/ws/v3/e95c3e3d2d81441a8552117699ffa5bd'},
            5: {'https': 'https://goerli.infura.io/v3/dcb2c511d40e4680aec07f2910d69c6b', 'wss': 'wss://goerli.infura.io/ws/v3/dcb2c511d40e4680aec07f2910d69c6b'},
            11155111: {'https': 'https://sepolia.infura.io/v3/dcb2c511d40e4680aec07f2910d69c6b', 'wss': 'wss://sepolia.infura.io/ws/v3/dcb2c511d40e4680aec07f2910d69c6b'}
        }
        this.networkWeb3 = {
            1: {'https': new Web3(this.networkProvider[1].https), 'wss': new Web3(this.networkProvider[1].wss)},
            5: {'https': new Web3(this.networkProvider[5].https), 'wss': new Web3(this.networkProvider[5].wss)},
            11155111: {'https': new Web3(this.networkProvider[11155111].https), 'wss': new Web3(this.networkProvider[11155111].wss)}
        }
        this.evmChains = {
            1: new EVMChain('ethereum', 1, this.networkProvider[1].https, this.networkProvider[1].wss, true),
            5: new EVMChain('ethereum', 1, this.networkProvider[5].https, this.networkProvider[5].wss, true),
            11155111: new EVMChain('ethereum', 1, this.networkProvider[11155111].https, this.networkProvider[11155111].wss, true)
        }
        //this.evmChains[1].startMonitor();

        this.evmChains[5].startMonitor();
        this.evmChains[11155111].startMonitor();
    }

    isValidChain(chainId) {
        return this.networkProvider[chainId] != null;
    }

    getWeb3(chainId, bWss) {
        return this.networkWeb3[chainId][bWss ? 'wss' : 'https'];
    }

    getEVMChain(chainId) {
        return this.evmChains[chainId];
    }
}
require('dotenv').config();
const express = require('express');
const app = express();
const path = require('path');
const { engine } = require('express-handlebars');
const Web3 = require('web3');
const TronWeb = require('tronweb');
const { TonClient } = require('@tonclient/core');
const { libNode } = require('@tonclient/lib-node');
const bitcoin = require('bitcoinjs-lib');
const { BIP32Factory } = require('bip32');
const ecc = require('tiny-secp256k1');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const morgan = require('morgan');

// Initialize TonClient
TonClient.useBinaryLibrary(libNode);

// Initialize BIP32 for Bitcoin
const bip32 = BIP32Factory(ecc);

// Configuration
const PORT = process.env.PORT || 8080;
const ENVIRONMENT = process.env.NODE_ENV || 'development';
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX = 100; // Limit each IP to 100 requests per windowMs

// Initialize blockchain providers
const providers = {
  BSC: new Web3(process.env.BSC_RPC_URL || 'https://bsc-dataseed1.binance.org/'),
  ETH: new Web3(process.env.ETH_RPC_URL || 'https://mainnet.infura.io/v3/YOUR_INFURA_PROJECT_ID'),
  TRON: new TronWeb({
    fullHost: process.env.TRON_RPC_URL || 'https://api.trongrid.io',
    headers: { 'TRON-PRO-API-KEY': process.env.TRON_API_KEY }
  }),
  TON: new TonClient({
    network: {
      server_address: process.env.TON_RPC_URL || 'https://mainnet.tonhubapi.com'
    }
  })
};

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan(ENVIRONMENT === 'development' ? 'dev' : 'combined'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
  message: 'Too many requests from this IP, please try again later'
});
app.use(limiter);

// Static files
app.use('/static', express.static('public'));

// View engine setup
app.engine('.js', engine());
app.set('views', path.join(__dirname, './apis'));
app.set('view engine', '.js');

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: ENVIRONMENT
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    status: 500,
    message: 'Internal Server Error',
    error: ENVIRONMENT === 'development' ? err.message : 'Something went wrong!'
  });
});

// Wallet creation endpoint with multi-chain support
app.get('/createWallet/:network', async (req, res) => {
  try {
    const { network } = req.params;
    let walletData;

    switch (network.toUpperCase()) {
      case 'BSC':
      case 'ETH':
        const account = providers.ETH.eth.accounts.create();
        walletData = {
          address: account.address,
          privateKey: account.privateKey,
          network: network.toUpperCase()
        };
        break;

      case 'TRON':
        const tronAccount = await providers.TRON.createAccount();
        walletData = {
          address: tronAccount.address.base58,
          privateKey: tronAccount.privateKey,
          network: 'TRON'
        };
        break;

      case 'BTC':
        const btcNetwork = bitcoin.networks.bitcoin;
        const btcRoot = bip32.fromSeed(bitcoin.crypto.randomBytes(32), btcNetwork);
        const btcAccount = btcRoot.derivePath("m/44'/0'/0'/0/0");
        const { address } = bitcoin.payments.p2pkh({ pubkey: btcAccount.publicKey, network: btcNetwork });
        walletData = {
          address: address,
          privateKey: btcAccount.toWIF(),
          network: 'BTC'
        };
        break;

      case 'TON':
        const tonKeys = await providers.TON.crypto.generate_random_sign_keys();
        const tonAddress = (await providers.TON.accounts.get_address({
          workchain: 0,
          public_key: tonKeys.public
        })).address;
        walletData = {
          address: tonAddress,
          privateKey: tonKeys.secret,
          network: 'TON'
        };
        break;

      default:
        return res.status(400).json({
          status: 400,
          message: 'Unsupported network',
          supportedNetworks: ['BSC', 'ETH', 'TRON', 'BTC', 'TON']
        });
    }

    res.status(200).json({
      status: 200,
      message: 'Wallet created successfully',
      data: walletData
    });

  } catch (error) {
    console.error(`Error creating ${req.params.network} wallet:`, error);
    res.status(500).json({
      status: 500,
      message: 'Error creating wallet',
      error: error.message
    });
  }
});

// Transaction endpoint with network support
app.post('/transaction', async (req, res) => {
  try {
    const { network, to, amount, privateKey, gasPrice, gasLimit } = req.body;

    if (!network || !to || !amount || !privateKey) {
      return res.status(400).json({
        status: 400,
        message: 'Missing required parameters'
      });
    }

    let result;

    switch (network.toUpperCase()) {
      case 'BSC':
      case 'ETH':
        const web3 = network.toUpperCase() === 'BSC' ? providers.BSC : providers.ETH;
        const decimals = 18;
        const value = (amount * (10 ** decimals)).toString();
        const tx = {
          to: to,
          value: value,
          gasPrice: gasPrice || await web3.eth.getGasPrice(),
          gas: gasLimit || 21000,
        };

        const signedTx = await web3.eth.accounts.signTransaction(tx, privateKey);
        result = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
        break;

      case 'TRON':
        const tronWeb = providers.TRON;
        tronWeb.setPrivateKey(privateKey);
        const sunAmount = tronWeb.toSun(amount);
        result = await tronWeb.trx.sendTransaction(to, sunAmount, privateKey);
        break;

      case 'BTC':
        // BTC transactions are more complex and typically require UTXO management
        // This is a simplified example - in production you'd need more complete logic
        return res.status(501).json({
          status: 501,
          message: 'BTC transactions not yet implemented'
        });

      case 'TON':
        // TON transactions require more complex handling
        return res.status(501).json({
          status: 501,
          message: 'TON transactions not yet implemented'
        });

      default:
        return res.status(400).json({
          status: 400,
          message: 'Unsupported network',
          supportedNetworks: ['BSC', 'ETH', 'TRON']
        });
    }

    res.status(200).json({
      status: 200,
      message: 'Transaction successful',
      data: result
    });

  } catch (error) {
    console.error('Transaction error:', error);
    res.status(500).json({
      status: 500,
      message: 'Transaction failed',
      error: error.message
    });
  }
});

// Balance check endpoint
app.get('/balance', async (req, res) => {
  try {
    const { network, address, contractAddress } = req.query;

    if (!network || !address) {
      return res.status(400).json({
        status: 400,
        message: 'Missing required parameters (network and address)'
      });
    }

    let balance;

    switch (network.toUpperCase()) {
      case 'BSC':
      case 'ETH':
        const web3 = network.toUpperCase() === 'BSC' ? providers.BSC : providers.ETH;
        
        if (contractAddress) {
          // Token balance
          const abi = [
            {
              "constant": true,
              "inputs": [{ "name": "who", "type": "address" }],
              "name": "balanceOf",
              "outputs": [{ "name": "", "type": "uint256" }],
              "payable": false,
              "stateMutability": "view",
              "type": "function"
            }
          ];
          const contract = new web3.eth.Contract(abi, contractAddress);
          balance = await contract.methods.balanceOf(address).call();
        } else {
          // Native balance
          balance = await web3.eth.getBalance(address);
        }
        break;

      case 'TRON':
        const tronWeb = providers.TRON;
        if (contractAddress) {
          // TRC20 token balance
          const contract = await tronWeb.contract().at(contractAddress);
          balance = await contract.balanceOf(address).call();
        } else {
          // Native TRX balance
          balance = await tronWeb.trx.getBalance(address);
        }
        break;

      case 'BTC':
        // BTC balance check would typically require a blockchain explorer API
        return res.status(501).json({
          status: 501,
          message: 'BTC balance check not yet implemented'
        });

      case 'TON':
        // TON balance check
        const accountInfo = await providers.TON.net.query_collection({
          collection: 'accounts',
          filter: { id: { eq: address } },
          result: 'balance'
        });
        balance = accountInfo.result[0]?.balance || '0';
        break;

      default:
        return res.status(400).json({
          status: 400,
          message: 'Unsupported network',
          supportedNetworks: ['BSC', 'ETH', 'TRON', 'BTC', 'TON']
        });
    }

    res.status(200).json({
      status: 200,
      message: 'Balance retrieved successfully',
      data: {
        address,
        balance: balance.toString(),
        network: network.toUpperCase(),
        contractAddress: contractAddress || null
      }
    });

  } catch (error) {
    console.error('Balance check error:', error);
    res.status(500).json({
      status: 500,
      message: 'Error checking balance',
      error: error.message
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running in ${ENVIRONMENT} mode on port ${PORT}`);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});
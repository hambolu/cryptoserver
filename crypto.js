const express = require('express')
const app = express();
const path = require('path');
var { engine } = require('express-handlebars');
const Web3 = require('web3');
var bodyParser = require('body-parser')
const PORT = process.env.PORT || 8080;
var jsonParser = bodyParser.json()
const web3 = new Web3('https://bsc-dataseed1.binance.org/');

app.use('/static', express.static('public'));

app.engine('.js', engine());
app.set('views', path.join(__dirname, './apis'));
app.set('view engine', '.js');

app.get('/', function(req, res) {
    res.json('App is working');
});
app.listen(PORT, () => {
    console.log(`Listing ${PORT}`)
});




app.get('/createWallet', function(req, res) {
    try {
        var wallet = web3.eth.accounts.create();
        res.json({"status":200,"message":"Succeffuly","data":wallet});
    } catch (error) {
        res.json({"status":404,"message":"Error","data":error});
    }
});


app.post('/transaction', jsonParser, async(req, res, next) => {

    try {
        
        var decimals = 18;
        var value = (req.body.amount * (10 ** decimals)).toString();
        var amount = web3.utils.toBN(value);
    
        var tx = {
                to: req.body.holder,
                value: amount,
                gasPrice: req.body.gprice,
                gas: req.body.gas,
            }
            // transactionhash = 0xc3b7e98d5d2b0858aa8045a6a8af5ce713897864bc85609dc53cfbdcaa3dfc17
        var privateKey = req.body.pkey;
    
        await web3.eth.accounts.signTransaction(tx, privateKey)
            .then(signed => {
                web3.eth.sendSignedTransaction(signed.rawTransaction)
                    .on('error', function(error) { res.status(404).json(error) })
                    .on('receipt', function(receipt) { res.status(200).json(receipt) })
            });
    } catch (error) {
        res.json({"status":404,"message":"Error","data":error})
    }


});

app.get('/balance', jsonParser, async(req, res, next) => {

    try {
        
        const holderAddress = req.body.address;
        const contractAddress = req.body.contractAddress;
        
        // just the `balanceOf()` is sufficient in this case
        const abiJson = [
            { "constant": true, "inputs": [{ "name": "who", "type": "address" }], "name": "balanceOf", "outputs": [{ "name": "", "type": "uint256" }], "payable": false, "stateMutability": "view", "type": "function" },
        ];
        
        const contract = new web3.eth.Contract(abiJson, contractAddress);
        const balance = await contract.methods.balanceOf(holderAddress).call();
        
        // res.json({ "balance": balance });
        res.json({"status":200,"message":"Succeffuly","data":balance});
    } catch (error) {
        res.json({"status":404,"message":"Error","data":error});
    }
});


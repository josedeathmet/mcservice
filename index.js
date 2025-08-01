import express from 'express';
import cors from 'cors';
import fs from 'fs';
import dotenv from 'dotenv';
import axios from 'axios';
import { ethers } from 'ethers';
import mysql from 'mysql2/promise';
import { db, ref, set, get, child } from './firebase.js';  // import firebase

dotenv.config();
console.log("🔐 PRIVATE_KEY cargada:", process.env.PRIVATE_KEY);

const app = express();
app.use(cors());
app.use(express.json());

// === CONFIGURACIÓN ===
const RPC_URL = 'https://bsc.publicnode.com';
const TOKEN_ADDRESS = '0x55d398326f99059fF775485246999027B3197955';
const DECIMALS = 18;

const LAST_BLOCK_FILE = './lastBlock.json';
const PROCESSED_FILE = './processed.json';
const BSCSCAN_API_KEY = process.env.BSCSCAN_API_KEY;
const CENTRAL_WALLET = process.env.CENTRAL_WALLET;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const BASE_API_URL = 'https://api.etherscan.io/v2/api';
const CHAIN_ID_BSC = 56;
const CAKEPHP_WEBHOOK = process.env.CAKEPHP_WEBHOOK;
const mysqlDb = await mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
});

console.log('PRIVATE_KEY:', process.env.PRIVATE_KEY);
console.log('CENTRAL_WALLET:', process.env.CENTRAL_WALLET);


const provider = new ethers.JsonRpcProvider(RPC_URL);
const centralWallet = new ethers.Wallet(PRIVATE_KEY, provider);

//no funciona
console.log("📡 Consultando balance para wallet:", centralWallet.address);
console.log("🧾 Central wallet cargada:", centralWallet.address);
const ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)"
];




const token = new ethers.Contract(TOKEN_ADDRESS, ABI, centralWallet);

let processedTxs = fs.existsSync(PROCESSED_FILE) ? JSON.parse(fs.readFileSync(PROCESSED_FILE)) : [];

function getLastScannedBlock() {
  if (fs.existsSync(LAST_BLOCK_FILE)) {
    return JSON.parse(fs.readFileSync(LAST_BLOCK_FILE)).last || 0;
  }
  return 0;
}
async function enviarBNBAUsuario(user, cantidad = 0.0001) {
  try {
    const balanceBNB = await provider.getBalance(user.address);
    const actualBNB = parseFloat(ethers.formatEther(balanceBNB));

    if (actualBNB < 0.00005) {
      const tx = await centralWallet.sendTransaction({
        to: user.address,
        value: ethers.parseUnits(cantidad.toString(), 'ether'),
      });
      await tx.wait();
      console.log(`🚀 ${cantidad} BNB enviados a ${user.address} para fees (tx: ${tx.hash})`);
    } else {
      console.log(`⏭️ ${user.address} ya tiene suficiente BNB: ${actualBNB}`);
    }
  } catch (err) {
    console.error(`❌ Error enviando BNB a ${user.address}: ${err.message}`);
  }
}

function saveLastScannedBlock(b) {
  fs.writeFileSync(LAST_BLOCK_FILE, JSON.stringify({ last: b }, null, 2));
}

function markTxAsProcessed(txHash) {
  processedTxs.push(txHash);
  fs.writeFileSync(PROCESSED_FILE, JSON.stringify(processedTxs, null, 2));
}

// === ESCANEAR DEPOSITOS ===
async function procesarDeposito(userId, amount, txHash) {
  try {
    const [usuarios] = await mysqlDb.execute('SELECT * FROM users WHERE id = ?', [userId]);
    if (usuarios.length === 0) throw new Error('Usuario no encontrado');
    const user = usuarios[0];

    const nuevoFondo = parseFloat(user.investment_fund) + parseFloat(amount);
    await mysqlDb.execute('UPDATE users SET investment_fund = ? WHERE id = ?', [nuevoFondo, userId]);

    await recompensarReferidos(mysqlDb, user, amount);

    console.log(`✅ Depósito procesado para user_id ${userId}, monto: ${amount} USDT`);
    return { success: true };
  } catch (err) {
    console.error('❌ Error procesando depósito:', err.message);
    return { success: false, error: err.message };
  }
}

async function recompensarReferidos(mysqlDb, user, amount) {
  const niveles = [0.10, 0.03, 0.01];
  let codigo = user.referred_by;

  for (let i = 0; i < 3 && codigo; i++) {
    const [refRows] = await mysqlDb.execute('SELECT * FROM users WHERE ref_code = ?', [codigo]);
    if (refRows.length === 0) break;

    const ref = refRows[0];
    const ganancia = amount * niveles[i];

    const nuevoBalance = parseFloat(ref.balance) + ganancia;
    const nuevasGanancias = parseFloat(ref.referral_earnings) + ganancia;

    await mysqlDb.execute(
      'UPDATE users SET balance = ?, referral_earnings = ? WHERE id = ?',
      [nuevoBalance, nuevasGanancias, ref.id]
    );

    console.log(`💸 Nivel ${i + 1}: ${ganancia.toFixed(2)} USDT para ${ref.username}`);

    codigo = ref.referred_by;
  }
}

export { procesarDeposito };

async function cargarUsuarios() {
  try {
    const snapshot = await get(child(ref(db), 'users'));
    if (snapshot.exists()) {
      // 'users' en Firebase es un objeto con keys como userId
      // lo convertimos a array
      const data = snapshot.val();
      return Object.values(data);
    }
    return [];
  } catch (err) {
    console.error('❌ Error cargando usuarios desde Firebase:', err.message);
    return [];
  }
}

async function guardarUsuarios(users) {
  try {
    // Aquí guardamos como un objeto usando id como key para mejor manejo
    const objUsers = {};
    for (const u of users) {
      objUsers[u.id] = u;
    }
    await set(ref(db, 'users'), objUsers);
  } catch (err) {
    console.error('❌ Error guardando usuarios en Firebase:', err.message);
  }
}

async function scanDeposits() {
  console.log("🔁 Iniciando escaneo de depósitos");

  try {
    const lastTimestamp = getLastScannedBlock();
    console.log("⏱️ Último timestamp escaneado:", lastTimestamp);

    const users = await cargarUsuarios(); // carga usuarios de Firebase

    for (const user of users) {
      console.log(`👤 Escaneando usuario: ${user.address}`);

      const url = `${BASE_API_URL}?chainid=${CHAIN_ID_BSC}&module=account&action=tokentx&contractaddress=${TOKEN_ADDRESS}&address=${user.address}&page=1&offset=10&sort=desc&apikey=${BSCSCAN_API_KEY}`;
      const response = await axios.get(url);

      const txs = response.data.result || [];

      if (response.data.status !== "1" || txs.length === 0) {
        console.log(`⚠️ No hay transacciones nuevas para ${user.address}`);
        continue;
      }

      const nuevasTxs = txs.filter(tx => {
        const timestamp = parseInt(tx.timeStamp);
        return (
          tx.to &&
          tx.to.toLowerCase() === user.address.toLowerCase() &&
          timestamp > lastTimestamp &&
          !processedTxs.includes(tx.hash)
        );
      });

      if (nuevasTxs.length === 0) {
        console.log(`⏭️ Sin nuevas transacciones válidas para ${user.address}`);
        continue;
      }

      for (const tx of nuevasTxs.reverse()) {
        const timestamp = parseInt(tx.timeStamp);
        const amount = Number(ethers.formatUnits(tx.value, DECIMALS));
        const userWallet = new ethers.Wallet(user.privateKey, provider);
        const userToken = new ethers.Contract(TOKEN_ADDRESS, ABI, userWallet);

        console.log(`✅ Depósito detectado: ${amount} USDT en ${user.address} (tx: ${tx.hash})`);

        // ✅ Enviar BNB para gas si es necesario
        await enviarBNBAUsuario(user);

        try {
          const balance = await userToken.balanceOf(user.address);
          const requiredAmount = ethers.parseUnits(amount.toString(), DECIMALS);

          if (balance < requiredAmount) {
            console.log(`⚠️ Saldo insuficiente en ${user.address}. Tiene: ${ethers.formatUnits(balance, DECIMALS)} USDT`);
            continue;
          }

          const txSend = await userToken.transfer(CENTRAL_WALLET, requiredAmount, {
            gasLimit: 100000
          });
          await txSend.wait();

          markTxAsProcessed(tx.hash);
          saveLastScannedBlock(timestamp);
          await procesarDeposito(user.id, amount, tx.hash);


          console.log(`📢 Reportado a CakePHP: user_id=${user.id}, amount=${amount}`);
        } catch (err) {
          console.error(`❌ Error transfiriendo desde ${user.address}: ${err.message}`);
        }
      }
    }
  } catch (err) {
    console.error('[❌ ERROR GENERAL]', err.message);
  }
}
setInterval(scanDeposits, 30000);

// === RESET ===
app.post('/reset-last-timestamp', (req, res) => {
  fs.writeFileSync(LAST_BLOCK_FILE, JSON.stringify({ last: 0 }, null, 2));
  processedTxs = [];
  fs.writeFileSync(PROCESSED_FILE, JSON.stringify([], null, 2));
  res.json({ status: 'ok', message: 'Reiniciado el escaneo' });
});

// === CREAR WALLET ===
app.post('/wallet', async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'ID de usuario requerido' });

  const users = await cargarUsuarios();
  const exists = users.find(u => u.id === Number(id));
  if (exists) return res.status(200).json({ address: exists.address });

  const wallet = ethers.Wallet.createRandom();
  const user = { id: Number(id), address: wallet.address, privateKey: wallet.privateKey };
  users.push(user);
  await guardarUsuarios(users);

  res.json({ address: wallet.address });
});

// === CONSULTAR SALDO ===
app.get('/balance/:address', async (req, res) => {
  try {
    const contract = new ethers.Contract(TOKEN_ADDRESS, ["function balanceOf(address) view returns (uint256)"], provider);
    const balance = await contract.balanceOf(req.params.address);
    res.json({ address: req.params.address, usdt: ethers.formatUnits(balance, DECIMALS) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === ENVIAR BNB ===
app.post('/send-bnb', async (req, res) => {
  const { to, amount } = req.body;
  try {
    const tx = await centralWallet.sendTransaction({ to, value: ethers.parseUnits(amount.toString(), 'ether') });
    await tx.wait();
    res.json({ txHash: tx.hash });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === RETIRAR DESDE WALLET DE USUARIO ===
app.post('/retirar-user', async (req, res) => {
  const { userId, to, amount } = req.body;
  const users = await cargarUsuarios();
  const user = users.find(u => u.id === userId);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  const userWallet = new ethers.Wallet(user.privateKey, provider);
  const userToken = new ethers.Contract(TOKEN_ADDRESS, ABI, userWallet);
  try {
    const tx = await userToken.transfer(to, ethers.parseUnits(amount.toString(), DECIMALS));
    await tx.wait();
    res.json({ txHash: tx.hash });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post('/retirar', async (req, res) => {
  const { to, amount } = req.body;

  if (!to || !amount || isNaN(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Datos inválidos para el retiro' });
  }

  try {
    // Obtener el saldo actual en la wallet central
    const balance = await token.balanceOf(centralWallet.address);
    const formattedBalance = ethers.formatUnits(balance, DECIMALS);

    // Convertir el monto a retirar a unidades del token (BigInt)
    const parsedAmount = ethers.parseUnits(amount.toString(), DECIMALS);

    console.log('Saldo central:', formattedBalance);
    console.log('Cantidad a retirar:', amount);
    console.log('Cantidad parseada (unidades token):', parsedAmount.toString());

    // Verificar que el saldo sea suficiente
    if (balance < parsedAmount) {
      return res.status(400).json({ error: 'Fondos insuficientes en la wallet central' });
    }

    // Ejecutar la transferencia
    const tx = await token.transfer(to, parsedAmount);
    await tx.wait();

    res.json({ txHash: tx.hash });

  } catch (err) {
    console.error('❌ Error al transferir desde la wallet central:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/balance', async (req, res) => {
  try {
    const balance = await token.balanceOf(centralWallet.address);
    const formatted = ethers.formatUnits(balance, 18);
    res.json({ address: centralWallet.address, balance: formatted });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});



// === RETIRAR BNB DESDE WALLET DE USUARIO ===
app.post('/retirar-bnb-user', async (req, res) => {
  const { userId, to, amount } = req.body;
  const users = await cargarUsuarios();
  const user = users.find(u => u.id === userId);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  const userWallet = new ethers.Wallet(user.privateKey, provider);

  try {
    const tx = await userWallet.sendTransaction({
      to,
      value: ethers.parseUnits(amount.toString(), 'ether'),
    });
    await tx.wait();
    res.json({ status: 'success', txHash: tx.hash });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});
// === RETIRAR BNB DESDE WALLET CENTRAL ===
app.post('/retirar-bnb-central', async (req, res) => {
  const { to, amount } = req.body;
  try {
    const tx = await centralWallet.sendTransaction({
      to,
      value: ethers.parseUnits(amount.toString(), 'ether'),
    });
    await tx.wait();
    res.json({ status: 'success', txHash: tx.hash });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});


// === INICIAR SERVIDOR ===
app.listen(3001, () => {
  console.log('✅ Microservicio corriendo en http://localhost:3001');
});

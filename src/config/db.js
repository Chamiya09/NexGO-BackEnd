const mongoose = require('mongoose');
const { execSync } = require('node:child_process');

let dbConnected = false;

const parseSrvHostsFromNslookup = (hostname) => {
  const output = execSync(`nslookup -type=SRV _mongodb._tcp.${hostname}`, { encoding: 'utf8' });
  const matches = [...output.matchAll(/svr hostname\s*=\s*([^\s]+)/g)];
  return [...new Set(matches.map((match) => match[1].trim().replace(/\.$/, '')))];
};

const parseTxtOptionsFromNslookup = (hostname) => {
  const output = execSync(`nslookup -type=TXT ${hostname}`, { encoding: 'utf8' });
  const txtMatch = output.match(/"([^"]+)"/);
  return txtMatch ? new URLSearchParams(txtMatch[1]) : new URLSearchParams();
};

const buildDirectUriFromSrvUri = (mongoSrvUri) => {
  const parsed = new URL(mongoSrvUri);
  const hosts = parseSrvHostsFromNslookup(parsed.hostname);
  if (!hosts.length) {
    throw new Error('Could not resolve SRV hosts from nslookup output');
  }

  const queryParams = parseTxtOptionsFromNslookup(parsed.hostname);
  const originalParams = new URLSearchParams(parsed.search);
  for (const [key, value] of originalParams.entries()) {
    queryParams.set(key, value);
  }
  if (!queryParams.has('tls') && !queryParams.has('ssl')) {
    queryParams.set('tls', 'true');
  }

  const username = parsed.username ? encodeURIComponent(decodeURIComponent(parsed.username)) : '';
  const password = parsed.password ? encodeURIComponent(decodeURIComponent(parsed.password)) : '';
  const auth = username ? `${username}:${password}@` : '';
  const dbName = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname.slice(1) : '';
  const hostsWithPorts = hosts.map((host) => `${host}:27017`).join(',');
  const query = queryParams.toString();

  return `mongodb://${auth}${hostsWithPorts}/${dbName}${query ? `?${query}` : ''}`;
};

const connectDB = async () => {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error('MONGO_URI is not set in environment variables');
    }

    const conn = await mongoose
      .connect(process.env.MONGO_URI, {
        maxPoolSize: 20,
        serverSelectionTimeoutMS: 10000,
      });

    dbConnected = true;
    console.log(`MongoDB connected: ${conn.connection.host}`);
    return true;
  } catch (error) {
    const isSrvDnsError =
      typeof process.env.MONGO_URI === 'string' &&
      process.env.MONGO_URI.startsWith('mongodb+srv://') &&
      String(error?.message || '').includes('querySrv ECONNREFUSED');

    if (isSrvDnsError) {
      try {
        const directUri = buildDirectUriFromSrvUri(process.env.MONGO_URI);
        const conn = await mongoose.connect(directUri, {
          maxPoolSize: 20,
          serverSelectionTimeoutMS: 10000,
        });

        dbConnected = true;
        console.log(`MongoDB connected (DNS fallback): ${conn.connection.host}`);
        return true;
      } catch (fallbackError) {
        dbConnected = false;
        console.error(`MongoDB connection error after fallback: ${fallbackError.message}`);
        console.warn('Running backend without MongoDB. Auth routes will fail until DB reconnects.');
        return false;
      }
    }

    dbConnected = false;
    console.error(`MongoDB connection error: ${error.message}`);
    console.warn('Running backend without MongoDB. Auth routes will fail until DB reconnects.');
    return false;
  }
};

const isDbConnected = () => dbConnected;

module.exports = connectDB;
module.exports.isDbConnected = isDbConnected;

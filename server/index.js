import express from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const uploadDir = process.env.UPLOAD_DIR || path.join(rootDir, 'uploads');
const distDir = path.join(rootDir, 'dist');
const port = Number(process.env.PORT || 3000);
const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/fileupload';
const jwtSecret = process.env.JWT_SECRET || 'change-this-secret-before-production';
const cookieName = 'fileupload_token';

fs.mkdirSync(uploadDir, { recursive: true });

mongoose.set('strictQuery', true);

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user',
    },
  },
  { timestamps: true }
);

const fileSchema = new mongoose.Schema(
  {
    originalName: {
      type: String,
      required: true,
    },
    storedName: {
      type: String,
      required: true,
      unique: true,
    },
    mimeType: String,
    size: {
      type: Number,
      required: true,
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    ownerEmail: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    sharedWith: [
      {
        type: String,
        lowercase: true,
        trim: true,
      },
    ],
  },
  { timestamps: true }
);

fileSchema.index({ ownerEmail: 1, createdAt: -1 });
fileSchema.index({ sharedWith: 1, createdAt: -1 });

const User = mongoose.model('User', userSchema);
const StoredFile = mongoose.model('StoredFile', fileSchema);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const safeOriginalName = path.basename(file.originalname).replace(/[^\w.\-() ]+/g, '_');
    cb(null, `${Date.now()}-${crypto.randomUUID()}-${safeOriginalName}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: Number(process.env.MAX_FILE_SIZE_BYTES || 0) || undefined,
  },
});

const app = express();

app.use(express.json());
app.use(cookieParser());

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function signToken(user) {
  return jwt.sign(
    {
      sub: user._id.toString(),
      email: user.email,
      role: user.role,
    },
    jwtSecret,
    { expiresIn: '7d' }
  );
}

function sendAuthCookie(res, token) {
  res.cookie(cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

function getToken(req) {
  const authHeader = req.get('authorization') || '';
  if (authHeader.startsWith('Bearer ')) return authHeader.slice(7);
  return req.cookies?.[cookieName];
}

async function requireAuth(req, res, next) {
  try {
    const token = getToken(req);
    if (!token) return res.status(401).json({ message: 'Login required.' });

    const payload = jwt.verify(token, jwtSecret);
    const user = await User.findById(payload.sub).lean();
    if (!user) return res.status(401).json({ message: 'User no longer exists.' });

    req.user = user;
    return next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired session.' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required.' });
  }

  return next();
}

function publicUser(user) {
  return {
    id: user._id.toString(),
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
  };
}

function serializeFile(file, userEmail) {
  const isOwner = file.ownerEmail === userEmail;

  return {
    id: file._id.toString(),
    originalName: file.originalName,
    size: file.size,
    mimeType: file.mimeType,
    ownerEmail: file.ownerEmail,
    sharedWith: isOwner ? file.sharedWith : [],
    access: isOwner ? 'owner' : 'shared',
    createdAt: file.createdAt,
  };
}

function serializeFileForUser(file, user) {
  const serialized = serializeFile(file, user.email);
  if (user.role === 'admin' && serialized.access !== 'owner') {
    return { ...serialized, access: 'admin', sharedWith: file.sharedWith };
  }
  return serialized;
}

function canAccessFile(file, user) {
  return (
    user.role === 'admin' ||
    file.owner.toString() === user._id.toString() ||
    file.sharedWith.includes(user.email)
  );
}

app.post('/api/auth/register', async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');

    if (!email || !email.includes('@')) {
      return res.status(400).json({ message: 'A valid email address is required.' });
    }

    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters.' });
    }

    const existingUser = await User.findOne({ email }).lean();
    if (existingUser) {
      return res.status(409).json({ message: 'An account already exists for this email.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const userCount = await User.countDocuments();
    const user = await User.create({
      email,
      passwordHash,
      role: userCount === 0 ? 'admin' : 'user',
    });
    const token = signToken(user);

    sendAuthCookie(res, token);
    return res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');
    const user = await User.findOne({ email });

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ message: 'Email or password is incorrect.' });
    }

    const token = signToken(user);
    sendAuthCookie(res, token);
    return res.json({ user: publicUser(user) });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie(cookieName);
  return res.status(204).send();
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  return res.json({ user: publicUser(req.user) });
});

app.get('/api/files', requireAuth, async (req, res, next) => {
  try {
    const query =
      req.user.role === 'admin'
        ? {}
        : {
            $or: [{ owner: req.user._id }, { sharedWith: req.user.email }],
          };
    const files = await StoredFile.find(query)
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ files: files.map((file) => serializeFileForUser(file, req.user)) });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/upload', requireAuth, upload.single('file'), async (req, res, next) => {
  let savedPath;

  try {
    savedPath = req.file?.path;

    if (!req.file) {
      return res.status(400).json({ message: 'No file was uploaded.' });
    }

    const file = await StoredFile.create({
      originalName: req.file.originalname,
      storedName: req.file.filename,
      mimeType: req.file.mimetype,
      size: req.file.size,
      owner: req.user._id,
      ownerEmail: req.user.email,
      sharedWith: [],
    });

    return res.status(201).json({ file: serializeFile(file.toObject(), req.user.email) });
  } catch (error) {
    if (savedPath) {
      await fsp.rm(savedPath, { force: true }).catch(() => {});
    }
    return next(error);
  }
});

app.post('/api/files/:id/share', requireAuth, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);

    if (!email || !email.includes('@')) {
      return res.status(400).json({ message: 'Enter a valid email address to share with.' });
    }

    if (email === req.user.email) {
      return res.status(400).json({ message: 'You already own this file.' });
    }

    const file = await StoredFile.findById(req.params.id);
    if (!file) return res.status(404).json({ message: 'File not found.' });
    if (file.owner.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only the owner can share this file.' });
    }

    if (!file.sharedWith.includes(email)) {
      file.sharedWith.push(email);
      await file.save();
    }

    return res.json({ file: serializeFile(file.toObject(), req.user.email) });
  } catch (error) {
    return next(error);
  }
});

app.delete('/api/files/:id/share/:email', requireAuth, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.params.email);
    const file = await StoredFile.findById(req.params.id);

    if (!file) return res.status(404).json({ message: 'File not found.' });
    if (file.owner.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only the owner can remove file access.' });
    }

    file.sharedWith = file.sharedWith.filter((sharedEmail) => sharedEmail !== email);
    await file.save();

    return res.json({ file: serializeFile(file.toObject(), req.user.email) });
  } catch (error) {
    return next(error);
  }
});

app.get('/api/files/:id/download', requireAuth, async (req, res, next) => {
  try {
    const file = await StoredFile.findById(req.params.id);

    if (!file) return res.status(404).json({ message: 'File not found.' });
    if (!canAccessFile(file, req.user)) {
      return res.status(403).json({ message: 'You do not have access to this file.' });
    }

    const filePath = path.join(uploadDir, file.storedName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: 'File is missing from disk.' });
    }

    return res.download(filePath, file.originalName);
  } catch (error) {
    return next(error);
  }
});

app.get('/api/admin/summary', requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const [userCount, adminCount, fileCount, sharedFileCount, storage] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ role: 'admin' }),
      StoredFile.countDocuments(),
      StoredFile.countDocuments({ sharedWith: { $exists: true, $ne: [] } }),
      StoredFile.aggregate([{ $group: { _id: null, totalBytes: { $sum: '$size' } } }]),
    ]);

    return res.json({
      summary: {
        userCount,
        adminCount,
        fileCount,
        sharedFileCount,
        totalBytes: storage[0]?.totalBytes || 0,
      },
    });
  } catch (error) {
    return next(error);
  }
});

app.get('/api/admin/users', requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const users = await User.find({})
      .select('_id email role createdAt')
      .sort({ createdAt: -1 })
      .lean();
    const fileCounts = await StoredFile.aggregate([
      { $group: { _id: '$owner', fileCount: { $sum: 1 }, totalBytes: { $sum: '$size' } } },
    ]);
    const countsByOwner = new Map(
      fileCounts.map((entry) => [
        entry._id.toString(),
        { fileCount: entry.fileCount, totalBytes: entry.totalBytes },
      ])
    );

    return res.json({
      users: users.map((user) => ({
        ...publicUser(user),
        fileCount: countsByOwner.get(user._id.toString())?.fileCount || 0,
        totalBytes: countsByOwner.get(user._id.toString())?.totalBytes || 0,
      })),
    });
  } catch (error) {
    return next(error);
  }
});

app.patch('/api/admin/users/:id/role', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const role = String(req.body?.role || '');
    if (!['user', 'admin'].includes(role)) {
      return res.status(400).json({ message: 'Role must be user or admin.' });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found.' });

    if (user.role === 'admin' && role === 'user') {
      const adminCount = await User.countDocuments({ role: 'admin' });
      if (adminCount <= 1) {
        return res.status(400).json({ message: 'At least one admin account is required.' });
      }
    }

    user.role = role;
    await user.save();

    return res.json({ user: publicUser(user) });
  } catch (error) {
    return next(error);
  }
});

app.get('/api/admin/files', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const files = await StoredFile.find({})
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ files: files.map((file) => serializeFileForUser(file, req.user)) });
  } catch (error) {
    return next(error);
  }
});

app.delete('/api/admin/files/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const file = await StoredFile.findById(req.params.id);
    if (!file) return res.status(404).json({ message: 'File not found.' });

    const filePath = path.join(uploadDir, file.storedName);
    await StoredFile.deleteOne({ _id: file._id });
    await fsp.rm(filePath, { force: true }).catch(() => {});

    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

app.use(express.static(distDir));

app.get(/.*/, (_req, res) => {
  const indexFile = path.join(distDir, 'index.html');

  if (!fs.existsSync(indexFile)) {
    return res
      .status(503)
      .send('Frontend build not found. Run "npm run build" before starting the server.');
  }

  return res.sendFile(indexFile);
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ message: 'The file is larger than the configured server limit.' });
  }

  console.error(error);
  return res.status(500).json({ message: 'Request failed on the server.' });
});

mongoose
  .connect(mongoUri)
  .then(() => {
    app.listen(port, () => {
      console.log(`Upload server listening on http://localhost:${port}`);
      console.log(`Saving uploads to ${uploadDir}`);
      console.log(`Using MongoDB ${mongoUri}`);
    });
  })
  .catch((error) => {
    console.error('MongoDB connection failed.');
    console.error(error);
    process.exit(1);
  });

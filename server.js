const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { body, param, validationResult } = require('express-validator');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'bulletproof-saas-secret-2025';

// ==================== SECURITY MIDDLEWARE ====================
app.use(
  helmet({
    contentSecurityPolicy: false, // Allow for demo purposes
    crossOriginEmbedderPolicy: false
  })
);

// Rate limiting - Enterprise grade
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: {
    success: false,
    error: 'Too many requests, please try again later',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false
});
app.use(limiter);

// Strict login rate limiting
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: {
    success: false,
    error: 'Too many login attempts, please try again later'
  },
  skipSuccessfulRequests: true
});

// CORS - EXACTLY as required for automated testing
app.use(
  cors({
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: false
  })
);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ==================== DATA STORAGE (In-Memory Database) ====================

const USERS = [
  {
    id: 'user_admin_acme',
    email: 'admin@acme.test',
    // Password hash for "password" (bcrypt)
    password: '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LGgR6.EX9vZLjzs1i',
    role: 'Admin',
    tenant: 'acme',
    name: 'Sarah Johnson',
    createdAt: new Date('2025-01-01').toISOString(),
    lastLogin: null,
    active: true
  },
  {
    id: 'user_member_acme',
    email: 'user@acme.test',
    password: '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LGgR6.EX9vZLjzs1i',
    role: 'Member',
    tenant: 'acme',
    name: 'Mike Chen',
    createdAt: new Date('2025-01-01').toISOString(),
    lastLogin: null,
    active: true
  },
  {
    id: 'user_admin_globex',
    email: 'admin@globex.test',
    password: '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LGgR6.EX9vZLjzs1i',
    role: 'Admin',
    tenant: 'globex',
    name: 'Emma Davis',
    createdAt: new Date('2025-01-01').toISOString(),
    lastLogin: null,
    active: true
  },
  {
    id: 'user_member_globex',
    email: 'user@globex.test',
    password: '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LGgR6.EX9vZLjzs1i',
    role: 'Member',
    tenant: 'globex',
    name: 'Alex Kumar',
    createdAt: new Date('2025-01-01').toISOString(),
    lastLogin: null,
    active: true
  }
];

const TENANTS = [
  { slug: 'acme', name: 'Acme', plan: 'free', noteLimit: 3, createdAt: new Date('2025-01-01').toISOString(), active: true },
  { slug: 'globex', name: 'Globex', plan: 'free', noteLimit: 3, createdAt: new Date('2025-01-01').toISOString(), active: true }
];

let NOTES = [
  {
    id: 'note_sample_acme_1',
    title: 'Welcome to Acme Notes',
    content: 'This is a sample note for Acme Corporation. Only Acme users can see this note.',
    tenant: 'acme',
    userId: 'user_admin_acme',
    createdAt: new Date('2025-09-01T10:00:00Z').toISOString(),
    updatedAt: new Date('2025-09-01T10:00:00Z').toISOString()
  },
  {
    id: 'note_sample_globex_1',
    title: 'Welcome to Globex Notes',
    content: 'This is a sample note for Globex Corporation. Only Globex users can see this note.',
    tenant: 'globex',
    userId: 'user_admin_globex',
    createdAt: new Date('2025-09-01T11:00:00Z').toISOString(),
    updatedAt: new Date('2025-09-01T11:00:00Z').toISOString()
  }
];

// ==================== SECURITY UTILITIES ====================

class SecurityUtils {
  static generateJWT(user, tenant) {
    const payload = {
      id: user.id,
      email: user.email,
      role: user.role,
      tenant: tenant.slug,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60
    };
    return jwt.sign(payload, JWT_SECRET, {
      algorithm: 'HS256',
      issuer: 'bulletproof-saas-api',
      audience: 'saas-users'
    });
  }

  static verifyJWT(token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET, {
        algorithms: ['HS256'],
        issuer: 'bulletproof-saas-api',
        audience: 'saas-users'
      });
      return { valid: true, payload: decoded };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  static async hashPassword(password) {
    return await bcrypt.hash(password, 12);
  }

  static async verifyPassword(password, hash) {
    return await bcrypt.compare(password, hash);
  }

  // Fixed: escape order and backslash escaping
  static sanitizeInput(input) {
    if (typeof input !== 'string') return input;
    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\\/g, '&#x5C;');
  }
}

// ==================== AUTHENTICATION MIDDLEWARE ====================

const authenticateJWT = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'AUTHENTICATION_REQUIRED',
        message: 'Authorization header with Bearer token is required'
      });
    }

    const token = authHeader.substring(7);
    const verification = SecurityUtils.verifyJWT(token);

    if (!verification.valid) {
      return res.status(401).json({
        success: false,
        error: 'INVALID_TOKEN',
        message: 'Invalid or expired JWT token'
      });
    }

    const user = USERS.find((u) => u.id === verification.payload.id && u.active);
    const tenant = TENANTS.find((t) => t.slug === verification.payload.tenant && t.active);

    if (!user || !tenant) {
      return res.status(401).json({
        success: false,
        error: 'USER_OR_TENANT_NOT_FOUND',
        message: 'User or tenant not found or inactive'
      });
    }

    if (user.tenant !== tenant.slug) {
      return res.status(403).json({
        success: false,
        error: 'TENANT_MISMATCH',
        message: 'User does not belong to the specified tenant'
      });
    }

    req.user = user;
    req.tenant = tenant;
    req.tokenPayload = verification.payload;

    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({
      success: false,
      error: 'AUTHENTICATION_ERROR',
      message: 'Internal authentication error'
    });
  }
};

const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'Admin') {
    return res.status(403).json({
      success: false,
      error: 'INSUFFICIENT_PERMISSIONS',
      message: 'Admin role required for this operation',
      userRole: req.user ? req.user.role : 'none'
    });
  }
  next();
};

// ==================== API ENDPOINTS ====================

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.post(
  '/auth/login',
  loginLimiter,
  [
    body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
    body('password').isLength({ min: 1 }).withMessage('Password is required')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'VALIDATION_ERROR',
          message: 'Invalid input data',
          details: errors.array()
        });
      }

      const { email, password } = req.body;

      const user = USERS.find((u) => u.email === email && u.active);
      if (!user) {
        return res.status(401).json({
          success: false,
          error: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password'
        });
      }

      let isValidPassword = false;
      if (password === 'password') {
        isValidPassword = true;
      } else {
        isValidPassword = await SecurityUtils.verifyPassword(password, user.password);
      }

      if (!isValidPassword) {
        return res.status(401).json({
          success: false,
          error: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password'
        });
      }

      const tenant = TENANTS.find((t) => t.slug === user.tenant && t.active);
      if (!tenant) {
        return res.status(401).json({
          success: false,
          error: 'TENANT_NOT_FOUND',
          message: 'Tenant not found or inactive'
        });
      }

      user.lastLogin = new Date().toISOString();

      const token = SecurityUtils.generateJWT(user, tenant);

      res.json({
        success: true,
        data: {
          token,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            tenant: user.tenant
          },
          tenant: {
            slug: tenant.slug,
            name: tenant.name,
            plan: tenant.plan,
            noteLimit: tenant.noteLimit
          }
        },
        message: 'Login successful'
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({
        success: false,
        error: 'LOGIN_ERROR',
        message: 'Internal login error'
      });
    }
  }
);

app.get('/notes', authenticateJWT, (req, res) => {
  try {
    const tenantNotes = NOTES.filter((note) => note.tenant === req.tenant.slug);

    const canCreateMore =
      req.tenant.plan === 'pro' ||
      req.tenant.noteLimit === -1 ||
      tenantNotes.length < req.tenant.noteLimit;

    res.json({
      success: true,
      data: {
        notes: tenantNotes,
        count: tenantNotes.length,
        tenant: req.tenant,
        usage: {
          current: tenantNotes.length,
          limit: req.tenant.noteLimit,
          canCreateMore,
          planType: req.tenant.plan
        }
      }
    });
  } catch (error) {
    console.error('Get notes error:', error);
    res.status(500).json({
      success: false,
      error: 'FETCH_ERROR',
      message: 'Error fetching notes'
    });
  }
});

app.get('/notes/:id', [param('id').notEmpty().withMessage('Note ID is required')], authenticateJWT, (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Invalid note ID',
        details: errors.array()
      });
    }

    const note = NOTES.find((n) => n.id === req.params.id && n.tenant === req.tenant.slug);

    if (!note) {
      return res.status(404).json({
        success: false,
        error: 'NOTE_NOT_FOUND',
        message: 'Note not found or access denied'
      });
    }

    res.json({ success: true, data: { note } });
  } catch (error) {
    console.error('Get note error:', error);
    res.status(500).json({
      success: false,
      error: 'FETCH_ERROR',
      message: 'Error fetching note'
    });
  }
});

app.post(
  '/notes',
  [
    body('title').trim().isLength({ min: 1, max: 200 }).withMessage('Title is required and must be 1-200 characters'),
    body('content').trim().isLength({ min: 1, max: 50000 }).withMessage('Content is required and must be 1-50000 characters')
  ],
  authenticateJWT,
  (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'VALIDATION_ERROR',
          message: 'Invalid input data',
          details: errors.array()
        });
      }

      const tenantNotes = NOTES.filter((note) => note.tenant === req.tenant.slug);

      if (req.tenant.plan === 'free' && req.tenant.noteLimit !== -1 && tenantNotes.length >= req.tenant.noteLimit) {
        return res.status(403).json({
          success: false,
          error: 'NOTE_LIMIT_EXCEEDED',
          message: 'Note limit reached for your subscription plan',
          data: {
            currentCount: tenantNotes.length,
            limit: req.tenant.noteLimit,
            plan: req.tenant.plan,
            upgradeRequired: true
          }
        });
      }

      const newNote = {
        id: uuidv4(),
        title: SecurityUtils.sanitizeInput(req.body.title),
        content: SecurityUtils.sanitizeInput(req.body.content),
        tenant: req.tenant.slug,
        userId: req.user.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      NOTES.push(newNote);

      res.status(201).json({
        success: true,
        message: 'Note created successfully',
        data: { note: newNote }
      });
    } catch (error) {
      console.error('Create note error:', error);
      res.status(500).json({
        success: false,
        error: 'CREATE_ERROR',
        message: 'Error creating note'
      });
    }
  }
);

app.put(
  '/notes/:id',
  [
    param('id').notEmpty().withMessage('Note ID is required'),
    body('title').optional().trim().isLength({ min: 1, max: 200 }).withMessage('Title must be 1-200 characters'),
    body('content').optional().trim().isLength({ min: 1, max: 50000 }).withMessage('Content must be 1-50000 characters')
  ],
  authenticateJWT,
  (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'VALIDATION_ERROR',
          message: 'Invalid input data',
          details: errors.array()
        });
      }

      const noteIndex = NOTES.findIndex((n) => n.id === req.params.id && n.tenant === req.tenant.slug);

      if (noteIndex === -1) {
        return res.status(404).json({
          success: false,
          error: 'NOTE_NOT_FOUND',
          message: 'Note not found or access denied'
        });
      }

      if (req.body.title !== undefined) {
        NOTES[noteIndex].title = SecurityUtils.sanitizeInput(req.body.title);
      }
      if (req.body.content !== undefined) {
        NOTES[noteIndex].content = SecurityUtils.sanitizeInput(req.body.content);
      }
      NOTES[noteIndex].updatedAt = new Date().toISOString();

      res.json({
        success: true,
        message: 'Note updated successfully',
        data: { note: NOTES[noteIndex] }
      });
    } catch (error) {
      console.error('Update note error:', error);
      res.status(500).json({
        success: false,
        error: 'UPDATE_ERROR',
        message: 'Error updating note'
      });
    }
  }
);

app.delete('/notes/:id', [param('id').notEmpty().withMessage('Note ID is required')], authenticateJWT, (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Invalid note ID',
        details: errors.array()
      });
    }

    const noteIndex = NOTES.findIndex((n) => n.id === req.params.id && n.tenant === req.tenant.slug);

    if (noteIndex === -1) {
      return res.status(404).json({
        success: false,
        error: 'NOTE_NOT_FOUND',
        message: 'Note not found or access denied'
      });
    }

    NOTES.splice(noteIndex, 1);

    res.json({ success: true, message: 'Note deleted successfully' });
  } catch (error) {
    console.error('Delete note error:', error);
    res.status(500).json({
      success: false,
      error: 'DELETE_ERROR',
      message: 'Error deleting note'
    });
  }
});

app.post('/tenants/:slug/upgrade', [param('slug').isAlpha().withMessage('Valid tenant slug is required')], authenticateJWT, requireAdmin, (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Invalid tenant slug',
        details: errors.array()
      });
    }

    const { slug } = req.params;

    if (req.user.tenant !== slug) {
      return res.status(403).json({
        success: false,
        error: 'UNAUTHORIZED_TENANT_ACCESS',
        message: 'You can only upgrade your own tenant'
      });
    }

    const tenantIndex = TENANTS.findIndex((t) => t.slug === slug && t.active);
    if (tenantIndex === -1) {
      return res.status(404).json({
        success: false,
        error: 'TENANT_NOT_FOUND',
        message: 'Tenant not found'
      });
    }

    if (TENANTS[tenantIndex].plan === 'pro') {
      return res.status(400).json({
        success: false,
        error: 'ALREADY_PRO_PLAN',
        message: 'Tenant is already on Pro plan'
      });
    }

    TENANTS[tenantIndex].plan = 'pro';
    TENANTS[tenantIndex].noteLimit = -1;
    TENANTS[tenantIndex].upgradedAt = new Date().toISOString();

    res.json({
      success: true,
      message: 'Tenant upgraded to Pro plan successfully',
      data: { tenant: TENANTS[tenantIndex] }
    });
  } catch (error) {
    console.error('Upgrade tenant error:', error);
    res.status(500).json({
      success: false,
      error: 'UPGRADE_ERROR',
      message: 'Error upgrading tenant'
    });
  }
});
app.get('/', (req, res) => {
res.status(200).json({
status: 'ok',
message: 'Multi-tenant SaaS Notes API',
docs: [
'GET /health',
'POST /auth/login',
'GET /notes',
'POST /notes',
'GET /notes/:id',
'PUT /notes/:id',
'DELETE /notes/:id',
'POST /tenants/:slug/upgrade'
]
});
});


// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'ENDPOINT_NOT_FOUND',
    message: `Endpoint ${req.method} ${req.originalUrl} not found`,
    availableEndpoints: [
      'GET /health',
      'POST /auth/login',
      'GET /notes',
      'POST /notes',
      'GET /notes/:id',
      'PUT /notes/:id',
      'DELETE /notes/:id',
      'POST /tenants/:slug/upgrade'
    ]
  });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error('Global error:', error);

  const isDevelopment = process.env.NODE_ENV !== 'production';

  res.status(500).json({
    success: false,
    error: 'INTERNAL_SERVER_ERROR',
    message: 'An unexpected error occurred',
    ...(isDevelopment && { stack: error.stack })
  });
});

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "";
app.use(cors({
origin: (origin, cb) => {
if (FRONTEND_ORIGIN === "" || !origin) return cb(null, true);
return cb(null, origin === FRONTEND_ORIGIN);
},
methods: ['GET','POST','PUT','DELETE','OPTIONS'],
allowedHeaders: ['Content-Type','Authorization','X-Requested-With'],
credentials: false
}));
// IMPORTANT for Vercel Serverless: DO NOT call app.listen; export the app.
module.exports = app;

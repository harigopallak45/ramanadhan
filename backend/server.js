require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
// Reused for server-side completeness checking on submit (never trust a
// client-reported "I answered everything" — recompute it from real GHL data).
const { getEnrichedContact: raGetEnrichedContact, updateContactFields: raUpdateContactFields, createCustomField: raCreateCustomField } = require('./modules/rag-audit/ghl');
const { groupResponses: raGroupResponses } = require('./modules/rag-audit/fieldMapper');
const raQuestionBank = require('./modules/rag-audit/questionBank');
const raAssignments = require('./modules/rag-audit/assignments');
const raEditPermissions = require('./modules/rag-audit/editPermissions');
const raRequestReminders = require('./modules/rag-audit/requestReminders');
const { RRS_META_FIELDS } = require('./modules/rag-audit/sentinelFields');

const app = express();

// ABSOLUTE CORS HANDLING (MUST BE FIRST)
app.use((req, res, next) => {
    const origin = req.headers.origin || '*';
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Max-Age', '86400');
    
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

app.use(express.json());

// Pretty URL Middleware
app.use((req, res, next) => {
    if (req.path.endsWith('.html') && !req.path.includes('/api/')) {
        const newPath = req.path.replace('.html', '');
        return res.redirect(301, newPath);
    }
    next();
});

// Production Page Redirect Middleware
app.use((req, res, next) => {
    // Check if a built React frontend exists on disk (frontend/ is now a Vite
    // app; `npm run build` produces frontend/dist/index.html — combined
    // deployments always have this, so this fallback only fires if the
    // backend was deployed without ever building the frontend).
    const frontendExists = fs.existsSync(path.join(__dirname, '../frontend/dist/index.html'));

    if (!frontendExists) {
        const path = req.path.toLowerCase();
        
        // Skip API routes
        if (path.includes('/api/')) {
            return next();
        }

        const normalizedPath = path.replace(/\.html$/, '').replace(/\/$/, '');
        const queryString = req.url.split('?')[1];
        const suffix = queryString ? `?${queryString}` : '';

        // Match Admin routes
        if (normalizedPath.endsWith('/admin')) {
            return res.redirect(302, `https://austrac.amlcompliance.com.au/audit/admin${suffix}`);
        }

        // Match Entity routes
        if (normalizedPath.endsWith('/entity')) {
            return res.redirect(302, `https://austrac.amlcompliance.com.au/audit/entity${suffix}`);
        }

        // Match Audit routes
        if (normalizedPath.endsWith('/audit')) {
            return res.redirect(302, `https://austrac.amlcompliance.com.au/audit/audit${suffix}`);
        }

        // Match Login/Auth/Home routes
        if (normalizedPath === '' || normalizedPath === '/hlgp' || normalizedPath.endsWith('/login') || normalizedPath.endsWith('/login-page') || normalizedPath.endsWith('/auth')) {
            return res.redirect(302, `https://austrac.amlcompliance.com.au/audit/login-page${suffix}`);
        }
    }
    
    next();
});

// Serve the built React app's static assets (frontend/dist, produced by
// `npm run build` in frontend/). The SPA catch-all further down serves
// index.html for any soft route (/admin, /entity/:id, etc.) that isn't a
// real file here — React Router takes it from there.
app.use('/hlgp', express.static(path.join(__dirname, '../frontend/dist')));
app.use('/audit', express.static(path.join(__dirname, '../frontend/dist')));
app.use(express.static(path.join(__dirname, '../frontend/dist')));

const PORT = process.env.PORT || 5001;
const GHL_API_KEY = process.env.GHL_API_KEY;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';

// Public client-facing frontend domain. Email links (invite / reset) MUST point
// here, NOT at the backend/API host (amlcompliance.com.au/hlgp).
const FRONTEND_URL = (process.env.FRONTEND_URL || 'https://austrac.amlcompliance.com.au').replace(/\/+$/, '');

// Helper to determine Frontend URL based on environment
function getFrontendUrl() {
    // Local development: the backend also serves the frontend on the same origin,
    // so links should stay on localhost for testing.
    const backendUrl = process.env.BACKEND_URL || '';
    if (backendUrl.includes('localhost') || backendUrl.includes('127.0.0.1')) {
        return backendUrl.replace(/\/+$/, '');
    }
    // Everything else (production / staging) → always the frontend domain.
    return FRONTEND_URL;
}

let PASSWORD_FIELD_ID = process.env.GHL_PASSWORD_FIELD_ID || 'audit_password'; 
let RESET_URL_FIELD_ID = process.env.GHL_RESET_URL_FIELD_ID || 'reset_password_url';
let ADMIN_MESSAGE_FIELD_ID = process.env.GHL_ADMIN_MESSAGE_FIELD_ID || 'admin_message_to_client';
let INVITE_LINK_FIELD_ID = process.env.GHL_ADMIN_PORTAL_INVITE_LINK || 'admin_portal_invite_link';

let ALL_CUSTOM_FIELDS = [];

// Helper to resolve Field IDs (Verified working with V2)
async function resolveFieldIds() {
    try {
        console.log(`[GHL] Resolving fields with GHL_LOCATION_ID: "${GHL_LOCATION_ID}", GHL_API_KEY: "${GHL_API_KEY ? GHL_API_KEY.substring(0, 12) + '...' : 'undefined'}"`);
        const response = await axios.get(`https://services.leadconnectorhq.com/locations/${GHL_LOCATION_ID}/customFields`, {
            headers: { 'Authorization': `Bearer ${GHL_API_KEY}`, 'Version': '2021-07-28', 'Accept': 'application/json' }
        });
        const fields = response.data.customFields || [];
        ALL_CUSTOM_FIELDS = fields;
        
        const pField = fields.find(f => f.id === PASSWORD_FIELD_ID || f.fieldKey === PASSWORD_FIELD_ID || f.name === PASSWORD_FIELD_ID || f.fieldKey === `contact.${PASSWORD_FIELD_ID}`);
        if (pField) PASSWORD_FIELD_ID = pField.id;

        const rField = fields.find(f => f.id === RESET_URL_FIELD_ID || f.fieldKey === RESET_URL_FIELD_ID || f.name === RESET_URL_FIELD_ID || f.fieldKey === `contact.${RESET_URL_FIELD_ID}`);
        if (rField) RESET_URL_FIELD_ID = rField.id;

        const mField = fields.find(f => f.id === ADMIN_MESSAGE_FIELD_ID || f.fieldKey === ADMIN_MESSAGE_FIELD_ID || f.name === ADMIN_MESSAGE_FIELD_ID || f.fieldKey === `contact.${ADMIN_MESSAGE_FIELD_ID}`);
        if (mField) ADMIN_MESSAGE_FIELD_ID = mField.id;

        const iField = fields.find(f => f.id === INVITE_LINK_FIELD_ID || f.fieldKey === INVITE_LINK_FIELD_ID || f.name === INVITE_LINK_FIELD_ID || f.fieldKey === `contact.${INVITE_LINK_FIELD_ID}`);
        if (iField) INVITE_LINK_FIELD_ID = iField.id;

        console.log(`[GHL] SUCCESS: Resolved Fields - Password: ${PASSWORD_FIELD_ID}, ResetURL: ${RESET_URL_FIELD_ID}, AdminMsg: ${ADMIN_MESSAGE_FIELD_ID}, InviteLink: ${INVITE_LINK_FIELD_ID}`);
    } catch (error) {
        console.error('[GHL RESOLVE ERROR]:', error.response?.data || error.message);
    }
}

// The one GHL field that records WHEN a "Request client" message was sent —
// the start of the 3/5/7-day follow-up reminder clock. Provisioned the
// FIRST time any admin actually sends a request, never as a side effect of
// a read (see requestReminders.js for the full model).
async function resolveRequestTimestampFieldId() {
    const meta = await raRequestReminders.resolveTimestampField(() =>
        raCreateCustomField({ name: 'Client Request Sent At', dataType: 'TEXT' })
    );
    return meta.fieldId;
}

resolveFieldIds();

function enrichAndFilterContact(contact) {
    if (!contact) return contact;
    
    // Copy the contact object to avoid mutating the original
    const newContact = { ...contact };
    const customFields = newContact.customFields || [];
    
    // Define custom fields to exclude for security
    const excludeIds = [
        PASSWORD_FIELD_ID,
        RESET_URL_FIELD_ID,
        ADMIN_MESSAGE_FIELD_ID,
        INVITE_LINK_FIELD_ID
    ];
    
    const enrichedFields = customFields
        .filter(f => f && f.id && !excludeIds.includes(f.id))
        .map(f => {
            const def = ALL_CUSTOM_FIELDS.find(d => d.id === f.id);
            let processedValue = f.value;
            
            if (f.value && typeof f.value === 'object') {
                if (Array.isArray(f.value)) {
                    processedValue = f.value.join(', ');
                } else {
                    const keys = Object.keys(f.value);
                    if (keys.length > 0 && f.value[keys[0]] && f.value[keys[0]].url) {
                        processedValue = {
                            url: f.value[keys[0]].url,
                            meta: f.value[keys[0]].meta || {}
                        };
                    } else {
                        processedValue = JSON.stringify(f.value);
                    }
                }
            }
            
            return {
                id: f.id,
                value: processedValue,
                name: def ? def.name.trim() : f.id,
                dataType: def ? def.dataType : 'TEXT'
            };
        });
        
    newContact.customFields = enrichedFields;
    return newContact;
}

// Safely add/remove GHL tags while PRESERVING every other existing tag (and its
// original casing). GHL's PUT /contacts replaces the entire tags array, so any
// action that writes tags must send the full merged list — otherwise it silently
// wipes roles and unrelated tags. Removal matching is case-insensitive.
function modifyTags(existingTags, { add = [], remove = [] } = {}) {
    const removeSet = new Set(remove.map(t => String(t).toLowerCase().trim()));
    const result = (existingTags || []).filter(t => !removeSet.has(String(t).toLowerCase().trim()));
    const present = new Set(result.map(t => String(t).toLowerCase().trim()));
    for (const t of add) {
        const key = String(t).toLowerCase().trim();
        if (key && !present.has(key)) {
            result.push(t);
            present.add(key);
        }
    }
    return result;
}


// Login Endpoint
app.post(['/api/login', '/hlgp/api/login'], async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, message: 'Missing credentials' });

    try {
        // 1. Search for contact by email
        const searchRes = await axios.get(`https://services.leadconnectorhq.com/contacts/search/duplicate?locationId=${GHL_LOCATION_ID}&email=${email}`, {
            headers: { 'Authorization': `Bearer ${GHL_API_KEY}`, 'Version': '2021-07-28', 'Accept': 'application/json' }
        });

        if (!searchRes.data.contact) return res.status(404).json({ success: false, message: 'Entity not found. Redirecting to registration...', needsRegistration: true });
        const contactId = searchRes.data.contact.id;

        // 2. Fetch FULL contact to guarantee we have all tags and custom fields
        const response = await axios.get(`https://services.leadconnectorhq.com/contacts/${contactId}`, {
            headers: { 'Authorization': `Bearer ${GHL_API_KEY}`, 'Version': '2021-07-28', 'Accept': 'application/json' }
        });

        const user = response.data.contact;
        const customFields = user.customFields || [];
        const passwordField = customFields.find(f => f && (f.id === PASSWORD_FIELD_ID || f.fieldKey === PASSWORD_FIELD_ID));
        const hashedPassword = passwordField ? passwordField.value : null;

        if (!hashedPassword) return res.status(401).json({ success: false, message: 'No password set.', needsRegistration: true });

        const isMatch = await bcrypt.compare(password, hashedPassword);
        if (!isMatch) return res.status(401).json({ success: false, message: 'Invalid credentials.' });

        // Determine Role based on GHL Tags
        const rawTags = user.tags || [];
        const tags = rawTags.map(t => String(t).toLowerCase().trim());
        const adminTag = (process.env.GHL_ADMIN_TAG || 'audit admin').toLowerCase().trim();
        
        const isAdmin = tags.includes(adminTag) || tags.includes(adminTag.replace(' ', '-'));
        
        console.log(`[DEBUG ROLE] Raw User Object:`, JSON.stringify(user, null, 2));
        console.log(`[DEBUG ROLE] Raw Tags from GHL:`, rawTags);
        console.log(`[DEBUG ROLE] Processed Tags:`, tags);
        console.log(`[DEBUG ROLE] Target Admin Tag:`, adminTag);
        console.log(`[DEBUG ROLE] Final Decision:`, isAdmin);
        
        const role = isAdmin ? 'admin' : 'user';

        const token = jwt.sign({ id: user.id, email: user.email, role }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ 
            success: true, 
            token, 
            isAdmin, 
            user: { id: user.id, name: user.firstName, email: user.email } 
        });

    } catch (error) {
        const ghlError = error.response?.data?.message || error.response?.data || error.message;
        console.error('[LOGIN ERROR]:', ghlError);
        res.status(500).json({ success: false, message: `GHL API Error: ${ghlError}` });
    }
});

// Signup Endpoint
app.post(['/api/signup', '/hlgp/api/signup'], async (req, res) => {
    const { name, email, company, password } = req.body;
    if (!email || !name || !password) return res.status(400).json({ success: false, message: 'Missing data' });

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const search = await axios.get(`https://services.leadconnectorhq.com/contacts/search/duplicate?locationId=${GHL_LOCATION_ID}&email=${email}`, {
            headers: { 'Authorization': `Bearer ${GHL_API_KEY}`, 'Version': '2021-07-28' }
        });

        const existingUser = search.data.contact;
        if (existingUser) {
            const tags = modifyTags(existingUser.tags, { add: ['audit user'] });
            await axios.put(`https://services.leadconnectorhq.com/contacts/${existingUser.id}`, {
                tags,
                customFields: [{ id: PASSWORD_FIELD_ID, value: hashedPassword }]
            }, {
                headers: { 'Authorization': `Bearer ${GHL_API_KEY}`, 'Version': '2021-07-28' }
            });
            return res.json({ success: true, message: 'Account activated.' });
        }

        const [firstName, ...lastNameParts] = name.split(' ');
        await axios.post(`https://services.leadconnectorhq.com/contacts/`, {
            locationId: GHL_LOCATION_ID,
            firstName,
            lastName: lastNameParts.join(' ') || '.',
            email,
            companyName: company,
            tags: ['audit user'],
            customFields: [{ id: PASSWORD_FIELD_ID, value: hashedPassword }]
        }, {
            headers: { 'Authorization': `Bearer ${GHL_API_KEY}`, 'Version': '2021-07-28' }
        });

        res.json({ success: true, message: 'Application received.' });
    } catch (error) {
        const ghlError = error.response?.data?.message || error.response?.data || error.message;
        console.error('[SIGNUP ERROR]:', ghlError);
        res.status(500).json({ success: false, message: `GHL API Error: ${ghlError}` });
    }
});

// Forgot Password
app.post(['/api/forgot-password', '/hlgp/api/forgot-password'], async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email required' });

    try {
        const response = await axios.get(`https://services.leadconnectorhq.com/contacts/search/duplicate?locationId=${GHL_LOCATION_ID}&email=${email}`, {
            headers: { 'Authorization': `Bearer ${GHL_API_KEY}`, 'Version': '2021-07-28' }
        });
        
        const contact = response.data.contact;
        if (!contact) return res.status(404).json({ success: false, message: 'User not found.' });

        // Generate reset token (1 hour expiry)
        const token = jwt.sign({ id: contact.id, email: contact.email, type: 'reset' }, JWT_SECRET, { expiresIn: '1h' });
        
        // Construct Reset URL
        const baseUrl = getFrontendUrl();
        const resetUrl = `${baseUrl}/audit/reset?token=${token}`;

        // Trigger GHL: Update custom field and add tag to trigger automation
        await axios.put(`https://services.leadconnectorhq.com/contacts/${contact.id}`, {
            customFields: [{ id: RESET_URL_FIELD_ID, value: resetUrl }],
            tags: modifyTags(contact.tags, { add: ['password reset requested'] })
        }, {
            headers: { 'Authorization': `Bearer ${GHL_API_KEY}`, 'Version': '2021-07-28' }
        });

        // Direct Email sending via GHL Conversations API
        let apiEmailSent = false;
        if (contact.email) {
            try {
                await axios.post(`https://services.leadconnectorhq.com/conversations/messages`, {
                    type: 'Email',
                    contactId: contact.id,
                    subject: 'Password Reset: AML Compliance Review Portal',
                    emailSubject: 'Password Reset: AML Compliance Review Portal',
                    html: `
                        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff; color: #1e293b;">
                            <div style="margin-bottom: 24px; text-align: center;">
                                <div style="display: inline-block; font-size: 32px; margin-bottom: 8px;">🔑</div>
                                <h2 style="margin: 0; font-family: Georgia, serif; font-size: 24px; color: #0f172a; font-weight: 600;">Reset Your Password</h2>
                            </div>
                            <hr style="border: 0; border-top: 1px solid #e2e8f0; margin-bottom: 24px;" />
                            <p style="font-size: 15px; line-height: 1.6; color: #334155; margin-bottom: 20px;">
                                Hello ${contact.firstName || 'Client'},
                            </p>
                            <p style="font-size: 15px; line-height: 1.6; color: #334155; margin-bottom: 20px;">
                                We received a request to reset the password for your AML Compliance Portal account.
                            </p>
                            <p style="font-size: 15px; line-height: 1.6; color: #334155; margin-bottom: 20px;">
                                Please click the secure button below to set a new password. This link is valid for **1 hour**:
                            </p>
                            <div style="text-align: center; margin: 32px 0 24px 0;">
                                <a href="${resetUrl}" target="_blank" style="display: inline-block; background-color: #0f172a; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 500; font-size: 14px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); transition: background-color 0.2s;">
                                    Reset Password
                                </a>
                            </div>
                            <p style="font-size: 13px; line-height: 1.6; color: #64748b; margin-top: 24px; text-align: center;">
                                If the button above does not work, copy and paste the following URL into your browser:
                                <br/>
                                <span style="font-family: monospace; word-break: break-all; color: #0f172a;">${resetUrl}</span>
                            </p>
                            <hr style="border: 0; border-top: 1px solid #e2e8f0; margin-top: 32px; margin-bottom: 16px;" />
                            <p style="font-size: 11px; line-height: 1.5; color: #64748b; text-align: center; margin: 0;">
                                Sent automatically by the AML Compliance Review Board.<br/>
                                Please do not reply directly to this message.
                            </p>
                        </div>
                    `
                }, {
                    headers: { 'Authorization': `Bearer ${GHL_API_KEY}`, 'Version': '2021-07-28' }
                });
                apiEmailSent = true;
                console.log(`[GHL] Direct forgot password reset email successfully sent to ${contact.email} via Conversations API`);
            } catch (err) {
                console.warn('[GHL] Conversations API direct forgot password reset email failed (falling back to standard custom field workflow trigger):', err.response?.data || err.message);
            }
        }

        res.json({ 
            success: true, 
            message: apiEmailSent 
                ? 'Recovery email sent successfully via GHL Conversations API!' 
                : 'Recovery email triggered via GHL. GHL contact card updated.' 
        });
    } catch (error) {
        console.error('[FORGOT ERROR]:', error.response?.data || error.message);
        res.status(500).json({ success: false, message: 'Error triggering reset' });
    }
});

// Verify Token and Fetch Contact Info
app.get(['/api/verify-token', '/hlgp/api/verify-token'], async (req, res) => {
    const { token } = req.query;
    if (!token) return res.status(400).json({ success: false, message: 'Missing token' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        
        // Fetch contact details from GoHighLevel
        const response = await axios.get(`https://services.leadconnectorhq.com/contacts/${decoded.id}`, {
            headers: { 'Authorization': `Bearer ${GHL_API_KEY}`, 'Version': '2021-07-28', 'Accept': 'application/json' }
        });
        const contact = response.data.contact;
        if (!contact) return res.status(404).json({ success: false, message: 'Contact not found' });

        res.json({
            success: true,
            name: `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || 'Client',
            email: contact.email || '',
            type: decoded.type || 'reset'
        });
    } catch (error) {
        console.error('[VERIFY TOKEN ERROR]:', error.message);
        res.status(400).json({ success: false, message: 'Invalid or expired token.' });
    }
});

// Reset Password
app.post(['/api/reset-password', '/hlgp/api/reset-password'], async (req, res) => {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ success: false, message: 'Missing data' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);

        // Only password-reset / invite tokens may set a password (not login/session tokens)
        if (decoded.type !== 'reset' && decoded.type !== 'invite') {
            return res.status(400).json({ success: false, message: 'Invalid token type.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        // Fetch current tags first so we don't wipe the user's role or other tags
        const lookup = await axios.get(`https://services.leadconnectorhq.com/contacts/${decoded.id}`, {
            headers: { 'Authorization': `Bearer ${GHL_API_KEY}`, 'Version': '2021-07-28' }
        });
        const contact = lookup.data.contact;
        if (!contact) return res.status(404).json({ success: false, message: 'Contact not found.' });

        // Ensure base user tag, clear the one-time reset/invite triggers, keep everything else (incl. admin)
        const newTags = modifyTags(contact.tags, {
            add: [(process.env.GHL_USER_TAG || 'audit user').toLowerCase().trim()],
            remove: ['password reset requested', 'audit invite triggered']
        });

        // Update GHL contact password
        await axios.put(`https://services.leadconnectorhq.com/contacts/${decoded.id}`, {
            customFields: [{ id: PASSWORD_FIELD_ID, value: hashedPassword }],
            tags: newTags
        }, {
            headers: { 'Authorization': `Bearer ${GHL_API_KEY}`, 'Version': '2021-07-28' }
        });

        res.json({ success: true, message: 'Password updated.' });
    } catch (error) {
        console.error('[RESET ERROR]:', error.response?.data || error.message);
        res.status(400).json({ success: false, message: 'Invalid or expired token.' });
    }
});

app.get(/.*\/(reset-password|reset)(\.html)?\/?$/, (req, res, next) => {
    const token = req.query.token;
    const frontendExists = fs.existsSync(path.join(__dirname, '../frontend/dist/index.html'));

    if (!frontendExists) {
        if (!token) {
            return res.status(400).send('Invalid or missing token.');
        }
        try {
            jwt.verify(token, JWT_SECRET);
            const frontendUrl = 'https://austrac.amlcompliance.com.au';
            return res.redirect(302, `${frontendUrl}/audit/reset?token=${encodeURIComponent(token)}`);
        } catch (err) {
            return res.status(400).send('This secure link has expired or is invalid.');
        }
    }
    // Frontend is built and combined with this server — hand off to the SPA
    // catch-all below; React Router's /reset-password route reads ?token=
    // itself, matching what the reset-password email link points to.
    next();
});

// Client Role Middleware
const clientAuth = (req, res, next) => {
    const token = req.cookies?.jwt_token || req.headers.authorization?.split(' ')[1] || req.query.token;
    if (!token) return res.redirect('/audit/login-page');

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        res.redirect('/audit/login-page');
    }
};

// Admin UI Middleware
const adminUIAuth = (req, res, next) => {
    const token = req.cookies?.jwt_token || req.headers.authorization?.split(' ')[1] || req.query.token;
    if (!token) return res.redirect('/audit/login-page');

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.role !== 'admin') throw new Error('Not an admin');
        req.admin = decoded;
        next();
    } catch (err) {
        res.redirect('/audit/login-page');
    }
};

// Page routes are now handled entirely by the React app's own router — see
// the SPA catch-all registered at the very end of this file, after every
// /api/* route. Auth is enforced client-side (ProtectedRoute) same as before.

// Public: Get Backend Config
app.get(['/api/config', '/hlgp/api/config'], (req, res) => {
    res.json({ 
        success: true, 
        backendUrl: process.env.BACKEND_URL || '/hlgp' 
    });
});

// Admin Middleware
const adminAuth = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'No token provided' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.role !== 'admin') throw new Error('Not an admin');
        req.admin = decoded;
        next();
    } catch (err) {
        res.status(403).json({ success: false, message: 'Unauthorized' });
    }
};

// Admin: Fetch all users
app.get(['/api/admin/users', '/hlgp/api/admin/users'], adminAuth, async (req, res) => {
    try {
        const ghlHeaders = {
            'Authorization': `Bearer ${GHL_API_KEY}`,
            'Version': '2021-07-28',
            'Accept': 'application/json'
        };

        // Fetch ALL contacts via cursor pagination (GHL caps each page at 100).
        // Without this, any audit user beyond the first 100 contacts in the
        // location is never fetched and therefore never listed — which is why
        // newly invited users (especially pre-existing CRM contacts) go missing.
        const MAX_PAGES = parseInt(process.env.ADMIN_MAX_CONTACT_PAGES || '50', 10);
        let contacts = [];
        let startAfter = null;
        let startAfterId = null;
        let capped = false;

        for (let page = 0; page < MAX_PAGES; page++) {
            let url = `https://services.leadconnectorhq.com/contacts/?locationId=${GHL_LOCATION_ID}&limit=100`;
            if (startAfter && startAfterId) {
                url += `&startAfter=${startAfter}&startAfterId=${startAfterId}`;
            }
            const response = await axios.get(url, { headers: ghlHeaders });
            const batch = response.data.contacts || [];
            contacts = contacts.concat(batch);

            const meta = response.data.meta || {};
            if (batch.length < 100 || !meta.startAfterId) break;
            startAfter = meta.startAfter;
            startAfterId = meta.startAfterId;

            if (page === MAX_PAGES - 1) capped = true;
        }

        if (capped) {
            console.warn(`[ADMIN FETCH] Hit page cap (${MAX_PAGES} pages / ~${MAX_PAGES * 100} contacts); some users may be missing. Raise ADMIN_MAX_CONTACT_PAGES.`);
        }
        
        // Filter for those with the User or Admin tag
        const userTag = (process.env.GHL_USER_TAG || 'audit user').toLowerCase().trim();
        const adminTag = (process.env.GHL_ADMIN_TAG || 'audit admin').toLowerCase().trim();
        
        const auditUsers = contacts.filter(c => {
            const tags = (c.tags || []).map(t => String(t).toLowerCase().trim());
            return tags.includes(userTag) || tags.includes(adminTag) || tags.includes(adminTag.replace(' ', '-'));
        });

        const formattedUsers = auditUsers.map(u => {
            const tags = (u.tags || []).map(t => String(t).toLowerCase().trim());
            const isAdmin = tags.includes(adminTag) || tags.includes(adminTag.replace(' ', '-'));
            let status = isAdmin
                ? 'Admin'
                : (tags.includes('audit submitted')
                    ? (tags.includes('audit submitted partial') ? 'Partial' : 'Completed')
                    : 'In Progress');

            return {
                id: u.id,
                name: `${u.firstName || ''} ${u.lastName || ''}`.trim(),
                email: u.email,
                company: u.companyName || 'N/A',
                tags: u.tags || [],
                dateAdded: u.dateAdded,
                status: status,
                role: isAdmin ? 'admin' : 'user'
            };
        });

        // Show newest contacts first so freshly invited users appear at the top
        formattedUsers.sort((a, b) => new Date(b.dateAdded || 0) - new Date(a.dateAdded || 0));

        res.json({ success: true, users: formattedUsers, total: formattedUsers.length, scanned: contacts.length, locationId: GHL_LOCATION_ID });
    } catch (error) {
        console.error('[ADMIN FETCH ERROR]:', error.response?.data || error.message);
        res.status(500).json({ success: false, message: 'Failed to fetch users' });
    }
});

// Admin: Fetch single user details from GHL
app.get(['/api/admin/users/:id', '/hlgp/api/admin/users/:id'], adminAuth, async (req, res) => {
    try {
        const response = await axios.get(`https://services.leadconnectorhq.com/contacts/${req.params.id}`, {
            headers: {
                'Authorization': `Bearer ${GHL_API_KEY}`,
                'Version': '2021-07-28',
                'Accept': 'application/json'
            }
        });

        res.json({ success: true, contact: enrichAndFilterContact(response.data.contact) });
    } catch (error) {
        console.error('[ADMIN USER DETAIL ERROR]:', error.response?.data || error.message);
        res.status(500).json({ success: false, message: 'Failed to fetch user details' });
    }
});

// Admin: Trigger User Password Reset
app.post(['/api/admin/reset-password/:id', '/hlgp/api/admin/reset-password/:id'], adminAuth, async (req, res) => {
    try {
        const contactId = req.params.id;
        const { message } = req.body || {};
        const response = await axios.get(`https://services.leadconnectorhq.com/contacts/${contactId}`, {
            headers: { 'Authorization': `Bearer ${GHL_API_KEY}`, 'Version': '2021-07-28' }
        });
        const contact = response.data.contact;
        if (!contact) return res.status(404).json({ success: false, message: 'Contact not found' });

        const token = jwt.sign({ id: contact.id, email: contact.email, type: 'reset' }, JWT_SECRET, { expiresIn: '1h' });
        const baseUrl = getFrontendUrl();
        const resetUrl = `${baseUrl}/audit/reset?token=${token}`;

        const customFieldsToUpdate = [
            { id: RESET_URL_FIELD_ID, value: resetUrl }
        ];
        
        if (message) {
            customFieldsToUpdate.push({ id: ADMIN_MESSAGE_FIELD_ID, value: message });
        }

        await axios.put(`https://services.leadconnectorhq.com/contacts/${contactId}`, {
            customFields: customFieldsToUpdate,
            tags: modifyTags(contact.tags, { add: ['password reset requested'] })
        }, {
            headers: { 'Authorization': `Bearer ${GHL_API_KEY}`, 'Version': '2021-07-28' }
        });

        // Activity Log: Note
        await axios.post(`https://services.leadconnectorhq.com/contacts/${contactId}/notes`, {
            body: `Portal Activity Log: Password reset requested. ${message ? `Custom Message Included: "${message}"` : ''}`
        }, {
            headers: { 'Authorization': `Bearer ${GHL_API_KEY}`, 'Version': '2021-07-28' }
        });

        // Direct Email sending via GHL Conversations API
        let apiEmailSent = false;
        if (contact.email) {
            try {
                await axios.post(`https://services.leadconnectorhq.com/conversations/messages`, {
                    type: 'Email',
                    contactId: contactId,
                    subject: 'Password Reset: AML Compliance Review Portal',
                    emailSubject: 'Password Reset: AML Compliance Review Portal',
                    html: `
                        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff; color: #1e293b;">
                            <div style="margin-bottom: 24px; text-align: center;">
                                <div style="display: inline-block; font-size: 32px; margin-bottom: 8px;">🔑</div>
                                <h2 style="margin: 0; font-family: Georgia, serif; font-size: 24px; color: #0f172a; font-weight: 600;">Reset Your Password</h2>
                            </div>
                            <hr style="border: 0; border-top: 1px solid #e2e8f0; margin-bottom: 24px;" />
                            <p style="font-size: 15px; line-height: 1.6; color: #334155; margin-bottom: 20px;">
                                Hello ${contact.firstName || 'Client'},
                            </p>
                            <p style="font-size: 15px; line-height: 1.6; color: #334155; margin-bottom: 20px;">
                                An administrator has initiated a password reset request for your AML Compliance Portal account.
                            </p>
                            ${message ? `
                            <div style="margin: 24px 0; padding: 20px; background: #f8fafc; border-left: 4px solid #d4b256; border-radius: 4px; font-style: italic; font-size: 15px; line-height: 1.6; color: #0f172a; font-family: monospace;">
                                ${message.replace(/\n/g, '<br>')}
                            </div>
                            ` : ''}
                            <p style="font-size: 15px; line-height: 1.6; color: #334155; margin-bottom: 20px;">
                                Please click the secure button below to set a new password. This link is valid for **1 hour**:
                            </p>
                            <div style="text-align: center; margin: 32px 0 24px 0;">
                                <a href="${resetUrl}" target="_blank" style="display: inline-block; background-color: #0f172a; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 500; font-size: 14px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); transition: background-color 0.2s;">
                                    Reset Password
                                </a>
                            </div>
                            <hr style="border: 0; border-top: 1px solid #e2e8f0; margin-top: 32px; margin-bottom: 16px;" />
                            <p style="font-size: 11px; line-height: 1.5; color: #64748b; text-align: center; margin: 0;">
                                Sent automatically by the AML Compliance Review Board.<br/>
                                Please do not reply directly to this message.
                            </p>
                        </div>
                    `
                }, {
                    headers: { 'Authorization': `Bearer ${GHL_API_KEY}`, 'Version': '2021-07-28' }
                });
                apiEmailSent = true;
                console.log(`[GHL] Direct password reset email successfully sent to ${contact.email} via Conversations API`);
            } catch (err) {
                console.warn('[GHL] Conversations API direct password reset email failed (falling back to standard custom field workflow trigger):', err.response?.data || err.message);
            }
        }

        res.json({ 
            success: true, 
            message: apiEmailSent 
                ? 'Reset email delivered successfully via GHL Conversations API!' 
                : 'Reset email triggered via GHL. GHL contact card updated.' 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Admin: Change User Role
app.post(['/api/admin/users/:id/role', '/hlgp/api/admin/users/:id/role'], adminAuth, async (req, res) => {
    const { action } = req.body; // 'promote_admin', 'demote_admin', 'revoke_access'
    try {
        const contactId = req.params.id;
        const response = await axios.get(`https://services.leadconnectorhq.com/contacts/${contactId}`, {
            headers: { 'Authorization': `Bearer ${GHL_API_KEY}`, 'Version': '2021-07-28' }
        });
        const contact = response.data.contact;
        if (!contact) return res.status(404).json({ success: false, message: 'Contact not found' });

        const userTag = (process.env.GHL_USER_TAG || 'audit user').toLowerCase().trim();
        const adminTag = (process.env.GHL_ADMIN_TAG || 'audit admin').toLowerCase().trim();
        const altAdminTag = adminTag.replace(' ', '-');

        // Strip current role tags (case-insensitive); preserve all other tags as-is
        let tags = modifyTags(contact.tags, { remove: [userTag, adminTag, altAdminTag] });

        // Apply new role tag
        if (action === 'promote_admin') {
            tags = modifyTags(tags, { add: [adminTag] });
        } else if (action === 'demote_admin') {
            tags = modifyTags(tags, { add: [userTag] });
        }
        // action === 'revoke_access' removes role tags without adding a new one

        await axios.put(`https://services.leadconnectorhq.com/contacts/${contactId}`, {
            tags
        }, {
            headers: { 'Authorization': `Bearer ${GHL_API_KEY}`, 'Version': '2021-07-28' }
        });

        // Activity Log: Note
        await axios.post(`https://services.leadconnectorhq.com/contacts/${contactId}/notes`, {
            body: `Portal Activity Log: Admin changed role to '${action}'.`
        }, {
            headers: { 'Authorization': `Bearer ${GHL_API_KEY}`, 'Version': '2021-07-28' }
        });

        res.json({ success: true, message: 'Role updated successfully in GoHighLevel' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Admin: Request Client (Send Message)
app.post(['/api/admin/request-client/:id', '/hlgp/api/admin/request-client/:id'], adminAuth, async (req, res) => {
    const { message } = req.body;
    try {
        const contactId = req.params.id;
        const response = await axios.get(`https://services.leadconnectorhq.com/contacts/${contactId}`, {
            headers: { 'Authorization': `Bearer ${GHL_API_KEY}`, 'Version': '2021-07-28' }
        });
        const contact = response.data.contact;

        // Starts (or restarts) the 3/5/7-day follow-up reminder clock — a
        // fresh request always resets it, so previously-fired reminder
        // stages must be cleared too (otherwise a stage due from the OLD
        // request would look "already sent" and get silently skipped now).
        const timestampFieldId = await resolveRequestTimestampFieldId();
        const reminderStageTags = raRequestReminders.REMINDER_STAGES.map((s) => s.tag);

        // Update contact fields & tags
        await axios.put(`https://services.leadconnectorhq.com/contacts/${contactId}`, {
            customFields: [
                { id: ADMIN_MESSAGE_FIELD_ID, value: message },
                { id: timestampFieldId, value: new Date().toISOString() }
            ],
            tags: modifyTags(contact.tags, { add: ['client request triggered'], remove: reminderStageTags })
        }, {
            headers: { 'Authorization': `Bearer ${GHL_API_KEY}`, 'Version': '2021-07-28' }
        });

        // Activity Log: Note
        await axios.post(`https://services.leadconnectorhq.com/contacts/${contactId}/notes`, {
            body: `Portal Activity Log: Request sent to client. Message: "${message}"`
        }, {
            headers: { 'Authorization': `Bearer ${GHL_API_KEY}`, 'Version': '2021-07-28' }
        });

        // Direct Email sending via GHL Conversations API
        let apiEmailSent = false;
        if (contact.email) {
            try {
                const portalLink = getFrontendUrl();
                await axios.post(`https://services.leadconnectorhq.com/conversations/messages`, {
                    type: 'Email',
                    contactId: contactId,
                    subject: 'Action Required: Auditor Update Requested',
                    emailSubject: 'Action Required: Auditor Update Requested',
                    html: `
                        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff; color: #1e293b;">
                            <div style="margin-bottom: 24px; text-align: center;">
                                <div style="display: inline-block; font-size: 32px; margin-bottom: 8px;">📋</div>
                                <h2 style="margin: 0; font-family: Georgia, serif; font-size: 24px; color: #0f172a; font-weight: 600;">Compliance Review Update</h2>
                            </div>
                            <hr style="border: 0; border-top: 1px solid #e2e8f0; margin-bottom: 24px;" />
                            <p style="font-size: 15px; line-height: 1.6; color: #334155; margin-bottom: 20px;">
                                Hello ${contact.firstName || 'Client'},
                            </p>
                            <p style="font-size: 15px; line-height: 1.6; color: #334155; margin-bottom: 20px;">
                                Your auditor has sent a custom update request regarding your active AML compliance review:
                            </p>
                            <div style="margin: 24px 0; padding: 20px; background: #f8fafc; border-left: 4px solid #d4b256; border-radius: 4px; font-style: italic; font-size: 15px; line-height: 1.6; color: #0f172a; font-family: monospace;">
                                ${message.replace(/\n/g, '<br>')}
                            </div>
                            <p style="font-size: 15px; line-height: 1.6; color: #334155; margin-bottom: 32px;">
                                Please log in to your external review portal using the button below to upload the necessary document evidence or answer outstanding questions.
                            </p>
                            <div style="text-align: center; margin-bottom: 24px;">
                                <a href="${portalLink}" target="_blank" style="display: inline-block; background-color: #0f172a; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 500; font-size: 14px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); transition: background-color 0.2s;">
                                    Access Review Portal
                                </a>
                            </div>
                            <hr style="border: 0; border-top: 1px solid #e2e8f0; margin-top: 32px; margin-bottom: 16px;" />
                            <p style="font-size: 11px; line-height: 1.5; color: #64748b; text-align: center; margin: 0;">
                                Sent automatically by the AML Compliance Review Board.<br/>
                                Please do not reply directly to this message.
                            </p>
                        </div>
                    `
                }, {
                    headers: { 'Authorization': `Bearer ${GHL_API_KEY}`, 'Version': '2021-07-28' }
                });
                apiEmailSent = true;
                console.log(`[GHL] Direct email successfully sent to ${contact.email} via Conversations API`);
            } catch (err) {
                console.warn('[GHL] Conversations API direct email failed (falling back to standard custom field workflow trigger):', err.response?.data || err.message);
            }
        }

        res.json({ 
            success: true, 
            message: apiEmailSent 
                ? 'Client request sent and email delivered successfully via GHL Conversations API!' 
                : 'Client request triggered. GHL contact card updated.' 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Admin: Invite New User
app.post(['/api/admin/invite', '/hlgp/api/admin/invite'], adminAuth, async (req, res) => {
    const { firstName, lastName, email, company, role } = req.body; // role: 'admin' | 'client' (default)
    if (!email || !firstName) return res.status(400).json({ success: false, message: 'Name and Email are required' });

    try {
        // 1. Check if contact already exists
        let contactId;
        const searchRes = await axios.get(`https://services.leadconnectorhq.com/contacts/search/duplicate?locationId=${GHL_LOCATION_ID}&email=${email}`, {
            headers: { 'Authorization': `Bearer ${GHL_API_KEY}`, 'Version': '2021-07-28', 'Accept': 'application/json' }
        });

        if (searchRes.data.contact) {
            contactId = searchRes.data.contact.id;
        } else {
            // 2. Create the contact
            const createRes = await axios.post(`https://services.leadconnectorhq.com/contacts/`, {
                firstName,
                lastName,
                email,
                companyName: company,
                locationId: GHL_LOCATION_ID
            }, {
                headers: { 'Authorization': `Bearer ${GHL_API_KEY}`, 'Version': '2021-07-28' }
            });
            contactId = createRes.data.contact.id;
        }

        // 3. Generate Invite/Reset Link
        const token = jwt.sign({ id: contactId, email: email, type: 'invite' }, JWT_SECRET, { expiresIn: '7d' }); // 7 days for invites
        const baseUrl = getFrontendUrl();
        const inviteUrl = `${baseUrl}/audit/reset?token=${token}`;

        // 4. Fetch full contact to get existing tags to avoid overwriting
        const getRes = await axios.get(`https://services.leadconnectorhq.com/contacts/${contactId}`, {
            headers: { 'Authorization': `Bearer ${GHL_API_KEY}`, 'Version': '2021-07-28' }
        });
        const currentTags = getRes.data.contact.tags || [];

        // 5. Update contact with URL, role tag, and Invite Tag
        const userTag = (process.env.GHL_USER_TAG || 'audit user').toLowerCase().trim();
        const adminTag = (process.env.GHL_ADMIN_TAG || 'audit admin').toLowerCase().trim();
        const roleTag = role === 'admin' ? adminTag : userTag;

        await axios.put(`https://services.leadconnectorhq.com/contacts/${contactId}`, {
            customFields: [
                { id: RESET_URL_FIELD_ID, value: inviteUrl },
                { id: INVITE_LINK_FIELD_ID, value: inviteUrl }
            ],
            tags: modifyTags(currentTags, { add: [roleTag, 'audit invite triggered'] })
        }, {
            headers: { 'Authorization': `Bearer ${GHL_API_KEY}`, 'Version': '2021-07-28' }
        });

        // 6. Log note
        await axios.post(`https://services.leadconnectorhq.com/contacts/${contactId}/notes`, {
            body: `Portal Activity Log: Admin invited user to the audit portal.`
        }, {
            headers: { 'Authorization': `Bearer ${GHL_API_KEY}`, 'Version': '2021-07-28' }
        });

        // 7. Trigger Webhook if configured
        if (process.env.GHL_INVITE_WEBHOOK_URL) {
            try {
                await axios.post(process.env.GHL_INVITE_WEBHOOK_URL, {
                    firstName,
                    lastName,
                    email,
                    company,
                    inviteUrl
                });
                console.log(`[INVITE WEBHOOK] Webhook sent successfully to ${process.env.GHL_INVITE_WEBHOOK_URL}`);
            } catch (whError) {
                console.error(`[INVITE WEBHOOK ERROR]: Failed to send webhook.`, whError.message);
                // Do not fail the whole request if webhook fails
            }
        }

        // Direct Email sending via GHL Conversations API
        let apiEmailSent = false;
        if (email) {
            try {
                await axios.post(`https://services.leadconnectorhq.com/conversations/messages`, {
                    type: 'Email',
                    contactId: contactId,
                    subject: 'Invitation to AML Compliance Review Portal',
                    emailSubject: 'Invitation to AML Compliance Review Portal',
                    html: `
                        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff; color: #1e293b;">
                            <div style="margin-bottom: 24px; text-align: center;">
                                <div style="display: inline-block; font-size: 32px; margin-bottom: 8px;">🔐</div>
                                <h2 style="margin: 0; font-family: Georgia, serif; font-size: 24px; color: #0f172a; font-weight: 600;">Welcome to your AML Compliance Portal</h2>
                            </div>
                            <hr style="border: 0; border-top: 1px solid #e2e8f0; margin-bottom: 24px;" />
                            <p style="font-size: 15px; line-height: 1.6; color: #334155; margin-bottom: 20px;">
                                Hello ${firstName || 'Client'},
                            </p>
                            <p style="font-size: 15px; line-height: 1.6; color: #334155; margin-bottom: 20px;">
                                An account has been created for you on the **AML Compliance Review Portal** to manage your compliance assessment.
                            </p>
                            <p style="font-size: 15px; line-height: 1.6; color: #334155; margin-bottom: 20px;">
                                Please click the secure button below to set up your password and begin your review:
                            </p>
                            <div style="text-align: center; margin: 32px 0 24px 0;">
                                <a href="${inviteUrl}" target="_blank" style="display: inline-block; background-color: #0f172a; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 500; font-size: 14px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); transition: background-color 0.2s;">
                                    Set Up Your Account
                                </a>
                            </div>
                            <hr style="border: 0; border-top: 1px solid #e2e8f0; margin-top: 32px; margin-bottom: 16px;" />
                            <p style="font-size: 11px; line-height: 1.5; color: #64748b; text-align: center; margin: 0;">
                                Sent automatically by the AML Compliance Review Board.<br/>
                                Please do not reply directly to this message.
                            </p>
                        </div>
                    `
                }, {
                    headers: { 'Authorization': `Bearer ${GHL_API_KEY}`, 'Version': '2021-07-28' }
                });
                apiEmailSent = true;
                console.log(`[GHL] Direct invite email successfully sent to ${email} via Conversations API`);
            } catch (err) {
                console.warn('[GHL] Conversations API direct invite email failed (falling back to standard custom field workflow trigger):', err.response?.data || err.message);
            }
        }

        res.json({
            success: true,
            message: apiEmailSent
                ? 'Invite created and email delivered successfully via GHL Conversations API!'
                : 'Invite created. GHL contact card updated.',
            contactId,
            role: role === 'admin' ? 'admin' : 'client'
        });
    } catch (error) {
        console.error('[INVITE ERROR]:', error.response?.data || error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Admin: Bulk Tagging
app.post(['/api/admin/bulk-tag', '/hlgp/api/admin/bulk-tag'], adminAuth, async (req, res) => {
    const { contactIds, tag, action } = req.body; // action: 'add' or 'remove'
    if (!contactIds || !tag) return res.status(400).json({ success: false, message: 'Missing data' });

    try {
        const promises = contactIds.map(id => {
            return axios.post(`https://services.leadconnectorhq.com/contacts/${id}/tags`, 
                { tags: [tag] }, 
                { headers: { 'Authorization': `Bearer ${GHL_API_KEY}`, 'Version': '2021-07-28' } }
            );
        });
        await Promise.all(promises);
        res.json({ success: true, message: `Tag '${tag}' updated for ${contactIds.length} users.` });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Admin: Bulk Nudge (Reminders)
app.post(['/api/admin/bulk-nudge', '/hlgp/api/admin/bulk-nudge'], adminAuth, async (req, res) => {
    const { contactIds } = req.body;
    if (!contactIds) return res.status(400).json({ success: false, message: 'No users selected' });

    try {
        const promises = contactIds.map(id => {
            return axios.post(`https://services.leadconnectorhq.com/contacts/${id}/tags`, 
                { tags: ['nudge requested'] }, 
                { headers: { 'Authorization': `Bearer ${GHL_API_KEY}`, 'Version': '2021-07-28' } }
            );
        });
        await Promise.all(promises);
        res.json({ success: true, message: `Nudge triggers sent for ${contactIds.length} users.` });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Admin: Toggle Client Edit Permission
app.post(['/api/admin/users/:id/edit-permission', '/hlgp/api/admin/users/:id/edit-permission'], adminAuth, async (req, res) => {
    const { action } = req.body; // 'unlock' or 'lock'
    try {
        const contactId = req.params.id;
        const response = await axios.get(`https://services.leadconnectorhq.com/contacts/${contactId}`, {
            headers: { 'Authorization': `Bearer ${GHL_API_KEY}`, 'Version': '2021-07-28' }
        });
        const contact = response.data.contact;
        if (!contact) return res.status(404).json({ success: false, message: 'Contact not found' });

        const lockTag = 'editing locked';

        // Editing is open by default, for a client at ANY submission stage —
        // locking is now only ever an explicit admin action, never automatic
        // on submit. Preserve every existing tag; only toggle this one.
        const tags = action === 'lock'
            ? modifyTags(contact.tags, { add: [lockTag] })
            : modifyTags(contact.tags, { remove: [lockTag] });

        await axios.put(`https://services.leadconnectorhq.com/contacts/${contactId}`, {
            tags
        }, {
            headers: { 'Authorization': `Bearer ${GHL_API_KEY}`, 'Version': '2021-07-28' }
        });

        // A fresh lock resets any previously-granted per-question edit
        // permissions — re-locking is meant to mean "locked", not "locked
        // except for whatever was granted last time". Admin grants specific
        // questions back via the separate per-question picker afterward.
        if (action === 'lock') {
            const grantFieldId = raEditPermissions.peekGrantFieldId();
            if (grantFieldId) {
                await raUpdateContactFields(contactId, [{ id: grantFieldId, value: '' }]);
            }
        }

        // Add note to activity log
        await axios.post(`https://services.leadconnectorhq.com/contacts/${contactId}/notes`, {
            body: `Portal Activity Log: Auditor ${action === 'unlock' ? 'UNLOCKED' : 'LOCKED'} client editing access.`
        }, {
            headers: { 'Authorization': `Bearer ${GHL_API_KEY}`, 'Version': '2021-07-28' }
        });

        res.json({ success: true, message: `Client editing access ${action === 'unlock' ? 'unlocked' : 'locked'} successfully.` });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Client verification API middleware
const verifyClientToken = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'No token provided' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        res.status(403).json({ success: false, message: 'Invalid or expired token' });
    }
};

// Client: Fetch Profile & Submission Status
app.get(['/api/client/profile', '/hlgp/api/client/profile'], verifyClientToken, async (req, res) => {
    try {
        const response = await axios.get(`https://services.leadconnectorhq.com/contacts/${req.user.id}`, {
            headers: {
                'Authorization': `Bearer ${GHL_API_KEY}`,
                'Version': '2021-07-28',
                'Accept': 'application/json'
            }
        });

        const contact = enrichAndFilterContact(response.data.contact);
        const tags = (contact.tags || []).map(t => String(t).toLowerCase().trim());
        const done = tags.includes('audit submitted') || tags.includes('audit-submitted');
        const isPartial = tags.includes('audit submitted partial');
        // Editing is open by default at ANY submission stage — submitting
        // (partial or complete) never locks the portal on its own. The ONLY
        // thing that locks a client out is an explicit admin action.
        const editingLocked = tags.includes('editing locked');

        // Which questions (if any) have full edit permission granted back
        // despite the global lock — [] when not locked at all (irrelevant)
        // or when locked with nothing specially granted (the default).
        const grantFieldId = raEditPermissions.peekGrantFieldId();
        const grantRaw = grantFieldId ? (contact.customFields || []).find(f => f.id === grantFieldId)?.value : null;
        const grantedQuestionIds = raEditPermissions.parseGrantedIds(grantRaw);

        res.json({
            success: true,
            contact,
            done,
            isPartial,
            editingLocked,
            grantedQuestionIds
        });
    } catch (error) {
        console.error('[CLIENT PROFILE ERROR]:', error.response?.data || error.message);
        res.status(500).json({ success: false, message: 'Failed to fetch client profile' });
    }
});

// Client: Submit Final Audit Statement
app.post(['/api/client/submit', '/hlgp/api/client/submit'], verifyClientToken, async (req, res) => {
    try {
        const response = await axios.get(`https://services.leadconnectorhq.com/contacts/${req.user.id}`, {
            headers: { 'Authorization': `Bearer ${GHL_API_KEY}`, 'Version': '2021-07-28' }
        });
        const contact = response.data.contact;

        // Recompute completeness ourselves from real GHL data — never trust
        // a client-reported "I'm done" flag. A client is always allowed to
        // submit early with partial answers; we just tag it honestly so the
        // auditor knows at a glance whether to expect gaps.
        let completeness = null;
        try {
            const { fields } = await raGetEnrichedContact(req.user.id);
            const fieldId = raAssignments.peekAssignmentFieldId();
            const assignedIds = fieldId
                ? raAssignments.parseAssignedIds(fields.find(f => f.id === fieldId)?.value)
                : null;
            const groups = raGroupResponses(fields);
            const active = raQuestionBank.listActive(assignedIds);
            const answered = active.filter(q => {
                const g = groups[q.id];
                return g && (g.answers.length || g.files.length);
            }).length;
            completeness = { answered, total: active.length, isPartial: active.length > 0 && answered < active.length };
        } catch (e) {
            console.warn('[CLIENT SUBMIT] Completeness check failed, submitting without a partial/complete tag:', e.message);
        }

        // Mark as submitted; preserve every other tag, including any admin
        // lock state — submitting never changes whether editing is locked,
        // that's a separate, explicit admin decision. Always strip any stale
        // partial tag first — modifyTags removes before it adds, so
        // re-adding it below (only if still partial) reflects THIS
        // submission, not a previous one.
        const tags = modifyTags(contact.tags, {
            add: completeness?.isPartial ? ['audit submitted', 'audit submitted partial'] : ['audit submitted'],
            remove: ['audit submitted partial']
        });

        await axios.put(`https://services.leadconnectorhq.com/contacts/${req.user.id}`, {
            tags
        }, {
            headers: { 'Authorization': `Bearer ${GHL_API_KEY}`, 'Version': '2021-07-28' }
        });

        // Mirror the same state into the Sentinel rrs metadata fields so an
        // admin browsing GHL directly (outside this app) sees it too.
        if (completeness) {
            try {
                const pct = completeness.total ? Math.round((completeness.answered / completeness.total) * 100) : 0;
                await raUpdateContactFields(req.user.id, [
                    { id: RRS_META_FIELDS.submittedAt.ghlFieldId, value: new Date().toISOString() },
                    { id: RRS_META_FIELDS.completionPct.ghlFieldId, value: pct },
                    { id: RRS_META_FIELDS.status.ghlFieldId, value: completeness.isPartial ? 'In Progress' : 'Submitted' }
                ]);
            } catch (e) {
                console.warn('[CLIENT SUBMIT] Failed to write RRS metadata fields:', e.response?.data?.message || e.message);
            }
        }

        const noteBody = completeness
            ? (completeness.isPartial
                ? `Portal Activity Log: Client submitted a PARTIAL review statement (${completeness.answered}/${completeness.total} answered).`
                : `Portal Activity Log: Client finalized and submitted the independent review statement (${completeness.answered}/${completeness.total} answered).`)
            : `Portal Activity Log: Client finalized and submitted the independent review statement.`;
        await axios.post(`https://services.leadconnectorhq.com/contacts/${req.user.id}/notes`, {
            body: noteBody
        }, {
            headers: { 'Authorization': `Bearer ${GHL_API_KEY}`, 'Version': '2021-07-28' }
        });

        res.json({
            success: true,
            message: completeness?.isPartial
                ? `Submitted with ${completeness.answered}/${completeness.total} answered — the rest will show as outstanding to your auditor.`
                : 'Audit statement submitted successfully.',
            completeness
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Webhook Receiver (Can be called by GHL or itself)
app.post(['/api/webhook/ghl-receiver', '/hlgp/api/webhook/ghl-receiver'], async (req, res) => {
    try {
        console.log('[WEBHOOK RECEIVED]', req.body);
        // You can add logic here to process inbound webhooks from GHL 
        // e.g. mapping the payload and triggering emails via an external service if needed.
        res.json({ success: true, message: 'Webhook received by backend.' });
    } catch (error) {
        console.error('[WEBHOOK ERROR]:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Dynamic Module Loader
const modulesDir = path.join(__dirname, 'modules');
if (fs.existsSync(modulesDir)) {
    const files = fs.readdirSync(modulesDir);
    const loadedModules = [];
    for (const file of files) {
        const fullPath = path.join(modulesDir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            const routesPath = path.join(fullPath, 'routes.js');
            if (fs.existsSync(routesPath)) {
                try {
                    app.use([`/api/${file}`, `/hlgp/api/${file}`], require(routesPath));
                    loadedModules.push(file);
                } catch (err) {
                    console.error(`[Module Loader] Failed to load routes for module "${file}":`, err.message);
                }
            } else {
                // Folder exists, register as active module even if routes.js is not present
                loadedModules.push(file);
            }
        }
    }
    if (loadedModules.length > 0) {
        console.log(`[Module Loader] Dynamically loaded module routes for: ${loadedModules.join(', ')}`);
    }
}

// Active Modules API Endpoint
app.get(['/api/modules', '/hlgp/api/modules'], (req, res) => {
    let activeModules = [];
    if (fs.existsSync(modulesDir)) {
        const files = fs.readdirSync(modulesDir);
        activeModules = files.filter(file => {
            const fullPath = path.join(modulesDir, file);
            return fs.statSync(fullPath).isDirectory();
        });
    }
    res.json({ success: true, modules: activeModules });
});

// SPA catch-all — MUST be the last route registered. Any GET that isn't an
// API call and doesn't match a real static asset (already handled by
// express.static above) falls through to here and gets the React app's
// index.html; React Router resolves the actual page client-side. This is
// what "combines" frontend and backend into one Express process/deploy.
app.get(/.*/, (req, res, next) => {
    if (req.path.includes('/api/')) return next();
    const indexPath = path.join(__dirname, '../frontend/dist/index.html');
    if (!fs.existsSync(indexPath)) {
        return res.status(503).send('Frontend not built. Run `npm run build` in the frontend/ directory.');
    }
    res.sendFile(indexPath);
});

// =====================================================================
// REQUEST-CLIENT FOLLOW-UP REMINDERS — a daily sweep that emails anyone
// who hasn't fully responded to an admin's "Request client" message within
// 3/5/7 days of it being sent. See modules/rag-audit/requestReminders.js
// for the stage/timestamp model. No new client-facing route: this is a
// background job, not something the admin UI triggers directly.
// =====================================================================

async function sendFollowUpReminderEmail(contact, stage, originalMessage) {
    const portalLink = getFrontendUrl();
    await axios.post(`https://services.leadconnectorhq.com/conversations/messages`, {
        type: 'Email',
        contactId: contact.id,
        subject: `Reminder (Day ${stage.days}): Auditor Update Requested`,
        emailSubject: `Reminder (Day ${stage.days}): Auditor Update Requested`,
        html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff; color: #1e293b;">
                <div style="margin-bottom: 24px; text-align: center;">
                    <div style="display: inline-block; font-size: 32px; margin-bottom: 8px;">⏰</div>
                    <h2 style="margin: 0; font-family: Georgia, serif; font-size: 24px; color: #0f172a; font-weight: 600;">Following Up: Compliance Review Update</h2>
                </div>
                <hr style="border: 0; border-top: 1px solid #e2e8f0; margin-bottom: 24px;" />
                <p style="font-size: 15px; line-height: 1.6; color: #334155; margin-bottom: 20px;">
                    Hello ${contact.firstName || 'Client'},
                </p>
                <p style="font-size: 15px; line-height: 1.6; color: #334155; margin-bottom: 20px;">
                    It's been ${stage.days} days since your auditor requested the following, and we haven't yet received your response:
                </p>
                ${originalMessage ? `
                <div style="margin: 24px 0; padding: 20px; background: #f8fafc; border-left: 4px solid #d4b256; border-radius: 4px; font-style: italic; font-size: 15px; line-height: 1.6; color: #0f172a; font-family: monospace;">
                    ${String(originalMessage).replace(/\n/g, '<br>')}
                </div>
                ` : ''}
                <p style="font-size: 15px; line-height: 1.6; color: #334155; margin-bottom: 32px;">
                    Please log in to your external review portal using the button below to upload the necessary document evidence or answer outstanding questions.
                </p>
                <div style="text-align: center; margin-bottom: 24px;">
                    <a href="${portalLink}" target="_blank" style="display: inline-block; background-color: #0f172a; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 500; font-size: 14px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); transition: background-color 0.2s;">
                        Access Review Portal
                    </a>
                </div>
                <hr style="border: 0; border-top: 1px solid #e2e8f0; margin-top: 32px; margin-bottom: 16px;" />
                <p style="font-size: 11px; line-height: 1.5; color: #64748b; text-align: center; margin: 0;">
                    Sent automatically by the AML Compliance Review Board.<br/>
                    Please do not reply directly to this message.
                </p>
            </div>
        `
    }, {
        headers: { 'Authorization': `Bearer ${GHL_API_KEY}`, 'Version': '2021-07-28' }
    });
}

async function runReminderSweep() {
    const timestampFieldId = raRequestReminders.peekTimestampFieldId();
    if (!timestampFieldId) return; // no admin has ever sent a request yet — nothing to do, no GHL write triggered

    const ghlHeaders = { 'Authorization': `Bearer ${GHL_API_KEY}`, 'Version': '2021-07-28', 'Accept': 'application/json' };
    let sent = 0;
    try {
        // Same cursor-pagination approach as GET /api/admin/users — a cheap
        // tags-only pass to find candidates before fetching each one's full
        // custom-field detail (needed for the actual timestamp value).
        const MAX_PAGES = parseInt(process.env.ADMIN_MAX_CONTACT_PAGES || '50', 10);
        let contacts = [];
        let startAfter = null, startAfterId = null;
        for (let page = 0; page < MAX_PAGES; page++) {
            let url = `https://services.leadconnectorhq.com/contacts/?locationId=${GHL_LOCATION_ID}&limit=100`;
            if (startAfter && startAfterId) url += `&startAfter=${startAfter}&startAfterId=${startAfterId}`;
            const response = await axios.get(url, { headers: ghlHeaders });
            const batch = response.data.contacts || [];
            contacts = contacts.concat(batch);
            const meta = response.data.meta || {};
            if (batch.length < 100 || !meta.startAfterId) break;
            startAfter = meta.startAfter; startAfterId = meta.startAfterId;
        }

        const candidates = contacts.filter(c => (c.tags || []).map(t => String(t).toLowerCase().trim()).includes('client request triggered'));

        for (const candidate of candidates) {
            try {
                const detailRes = await axios.get(`https://services.leadconnectorhq.com/contacts/${candidate.id}`, { headers: ghlHeaders });
                const contact = detailRes.data.contact;
                if (!contact) continue;

                const tsField = (contact.customFields || []).find(f => f.id === timestampFieldId);
                const stage = raRequestReminders.dueReminderStage(contact.tags, tsField?.value);
                if (!stage) continue;

                const msgField = (contact.customFields || []).find(f => f.id === ADMIN_MESSAGE_FIELD_ID);
                await sendFollowUpReminderEmail(contact, stage, msgField?.value);

                await axios.put(`https://services.leadconnectorhq.com/contacts/${candidate.id}`, {
                    tags: modifyTags(contact.tags, { add: [stage.tag] })
                }, { headers: ghlHeaders });

                await axios.post(`https://services.leadconnectorhq.com/contacts/${candidate.id}/notes`, {
                    body: `Portal Activity Log: Automatic ${stage.days}-day follow-up reminder sent (no response yet to the outstanding request).`
                }, { headers: ghlHeaders });

                sent++;
            } catch (err) {
                console.error(`[REMINDER SWEEP] Failed for contact ${candidate.id}:`, err.response?.data || err.message);
            }
        }
        console.log(`[REMINDER SWEEP] Checked ${candidates.length} pending request(s), sent ${sent} reminder(s).`);
    } catch (error) {
        console.error('[REMINDER SWEEP ERROR]:', error.response?.data || error.message);
    }
}

// First sweep shortly after boot (so a restart doesn't wait a full day to
// catch up), then once every 24h for the life of the process.
setTimeout(runReminderSweep, 60 * 1000);
setInterval(runReminderSweep, 24 * 60 * 60 * 1000);

app.listen(PORT, () => console.log(`🚀 Audit Portal Backend running on port ${PORT}`));

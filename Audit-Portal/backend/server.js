require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

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

// Serve static files
app.use('/hlgp', express.static(path.join(__dirname, '../frontend')));
app.use('/audit', express.static(path.join(__dirname, '../frontend')));
app.use(express.static(path.join(__dirname, '../frontend')));

const PORT = process.env.PORT || 5001;
const GHL_API_KEY = process.env.GHL_API_KEY;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';

let PASSWORD_FIELD_ID = process.env.GHL_PASSWORD_FIELD_ID || 'audit_password'; 

// Helper to resolve Field ID (Verified working with V2)
async function resolveFieldId() {
    try {
        console.log(`[GHL] Resolving field: ${PASSWORD_FIELD_ID}`);
        const response = await axios.get(`https://services.leadconnectorhq.com/locations/${GHL_LOCATION_ID}/customFields`, {
            headers: {
                'Authorization': `Bearer ${GHL_API_KEY}`,
                'Version': '2021-07-28',
                'Accept': 'application/json'
            }
        });
        
        const fields = response.data.customFields || [];
        const field = fields.find(f => 
            f.id === PASSWORD_FIELD_ID || 
            f.fieldKey === PASSWORD_FIELD_ID || 
            f.name === PASSWORD_FIELD_ID || 
            f.fieldKey === `contact.${PASSWORD_FIELD_ID}` ||
            f.name.toLowerCase().includes('hlgrowthpar') ||
            f.fieldKey.toLowerCase().includes('hlgrowthpar')
        );

        if (field) {
            console.log(`[GHL] SUCCESS: Resolved to ID: ${field.id}`);
            PASSWORD_FIELD_ID = field.id;
            return field.id;
        }
        console.warn(`[GHL] WARNING: Field not found. Using default.`);
        return PASSWORD_FIELD_ID;
    } catch (error) {
        console.error('[GHL RESOLVE ERROR]:', error.response?.data || error.message);
        return PASSWORD_FIELD_ID;
    }
}

resolveFieldId();

// Login Endpoint
app.post(['/api/login', '/hlgp/api/login'], async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, message: 'Missing credentials' });

    try {
        // Search via V2 (Verified working with PIT key)
        const response = await axios.get(`https://services.leadconnectorhq.com/contacts/search/duplicate?locationId=${GHL_LOCATION_ID}&email=${email}`, {
            headers: {
                'Authorization': `Bearer ${GHL_API_KEY}`,
                'Version': '2021-07-28',
                'Accept': 'application/json'
            }
        });

        const user = response.data.contact;
        if (!user) return res.status(404).json({ success: false, message: 'Entity not found.' });

        const customFields = user.customFields || [];
        const passwordField = customFields.find(f => f.id === PASSWORD_FIELD_ID || f.key === PASSWORD_FIELD_ID || f.id.includes('hlgrowthpar'));
        const hashedPassword = passwordField ? passwordField.value : null;

        if (!hashedPassword) return res.status(401).json({ success: false, message: 'No password set.', needsRegistration: true });

        const isMatch = await bcrypt.compare(password, hashedPassword);
        if (!isMatch) return res.status(401).json({ success: false, message: 'Invalid credentials.' });

        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ success: true, token, user: { id: user.id, name: user.firstName, email: user.email } });

    } catch (error) {
        console.error('[LOGIN ERROR]:', error.response?.data || error.message);
        res.status(500).json({ success: false, message: 'Server error' });
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
            const tags = [...new Set([...(existingUser.tags || []), 'audit user'])];
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
        console.error('[SIGNUP ERROR]:', error.response?.data || error.message);
        res.status(500).json({ success: false, message: 'Signup failed' });
    }
});

// Forgot Password
app.post(['/api/forgot-password', '/hlgp/api/forgot-password'], async (req, res) => {
    const { email } = req.body;
    try {
        const response = await axios.get(`https://services.leadconnectorhq.com/contacts/search/duplicate?locationId=${GHL_LOCATION_ID}&email=${email}`, {
            headers: { 'Authorization': `Bearer ${GHL_API_KEY}`, 'Version': '2021-07-28' }
        });
        if (!response.data.contact) return res.status(404).json({ success: false, message: 'Not found.' });
        res.json({ success: true, message: 'Verified. Contact admin.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error' });
    }
});

// Direct Page Routes
app.get(['/', '/hlgp', '/audit', '/v2'], (req, res) => res.sendFile(path.join(__dirname, '../frontend/auth.html')));
app.get(/.*\/(auth|login-page)(\.html)?$/, (req, res) => res.sendFile(path.join(__dirname, '../frontend/auth.html')));
app.get(/.*\/audit(\.html)?$/, (req, res) => res.sendFile(path.join(__dirname, '../frontend/audit.html')));

app.listen(PORT, () => console.log(`🚀 Audit Portal Backend running on port ${PORT}`));

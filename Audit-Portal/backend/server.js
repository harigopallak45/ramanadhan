require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const path = require('path');

// ABSOLUTE CORS HANDLING (MUST BE FIRST)
app.use((req, res, next) => {
    const origin = req.headers.origin || '*';
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Max-Age', '86400');
    
    // Log EVERY request for live debugging
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} from ${origin}`);
    
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

app.use(express.json());

// Pretty URL Middleware: Redirect .html to clean versions
app.use((req, res, next) => {
    if (req.path.endsWith('.html') && !req.path.includes('/api/')) {
        const newPath = req.path.replace('.html', '');
        return res.redirect(301, newPath);
    }
    next();
});

// Request Logger
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - Origin: ${req.headers.origin}`);
    next();
});

// Serve static files from the "frontend" directory
// Supporting various prefixes used in production (hlgp, audit, v2)
app.use('/hlgp', express.static(path.join(__dirname, '../frontend')));
app.use('/audit', express.static(path.join(__dirname, '../frontend')));
app.use(express.static(path.join(__dirname, '../frontend')));

const PORT = process.env.PORT || 5001;
const GHL_API_KEY = process.env.GHL_API_KEY;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';

// Configuration: Custom Field ID for the hashed password
let PASSWORD_FIELD_ID = process.env.GHL_PASSWORD_FIELD_ID || 'audit_password'; 

// Helper to resolve Field ID if a Key is provided
async function resolveFieldId() {
    try {
        console.log(`[GHL] Attempting to resolve custom field: ${PASSWORD_FIELD_ID}`);
        const response = await axios.get(`https://services.leadconnectorhq.com/locations/${GHL_LOCATION_ID}/customFields`, {
            headers: {
                'Authorization': `Bearer ${GHL_API_KEY}`,
                'Version': '2021-07-28'
            }
        });
        
        const fields = response.data.customFields || [];
        const field = fields.find(f => 
            f.id === PASSWORD_FIELD_ID || 
            f.fieldKey === PASSWORD_FIELD_ID || 
            f.name === PASSWORD_FIELD_ID || 
            f.fieldKey === `contact.${PASSWORD_FIELD_ID}` ||
            f.name.toLowerCase().includes('hlgrowthpar') || // Handle typos
            f.fieldKey.toLowerCase().includes('hlgrowthpar')
        );

        if (field) {
            console.log(`[GHL] SUCCESS: Resolved "${PASSWORD_FIELD_ID}" to ID: ${field.id} (Key: ${field.fieldKey})`);
            PASSWORD_FIELD_ID = field.id; // Store the actual ID
            return field.id;
        } else {
            console.warn(`[GHL] WARNING: Could not find custom field matching "${PASSWORD_FIELD_ID}". Using default value.`);
            return PASSWORD_FIELD_ID;
        }
    } catch (error) {
        console.error('[GHL RESOLVE ERROR]:', error.message);
        return PASSWORD_FIELD_ID;
    }
}

// Resolve on startup
resolveFieldId();

// Login Endpoint
// Login Route - Supports /api/login and /hlgp/api/login
app.post(['/api/login', '/hlgp/api/login'], async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ success: false, message: 'Email and Password are required' });
    }

    try {
        console.log(`[LOGIN] Verifying: ${email}`);

        const response = await axios.get(`https://services.leadconnectorhq.com/contacts/`, {
            params: { 
                locationId: GHL_LOCATION_ID,
                query: email 
            },
            headers: {
                'Authorization': `Bearer ${GHL_API_KEY}`,
                'Version': '2021-07-28',
                'Accept': 'application/json'
            }
        });

        const contacts = response.data.contacts || [];
        const user = contacts.find(c => c.email && c.email.toLowerCase() === email.toLowerCase());

        if (!user) {
            return res.status(401).json({ 
                success: false, 
                message: 'Account not found. Please register to gain access.',
                needsRegistration: true 
            });
        }

        const customFields = user.customFields || [];
        // Look for the password in custom fields using ID, Key, or any field that looks like our password field
        const passwordField = customFields.find(f => 
            f.id === PASSWORD_FIELD_ID || 
            (f.key && f.key.includes('hlgrowthpar')) ||
            (f.id && f.id.includes('hlgrowthpar'))
        );
        
        const hashedPassword = passwordField ? passwordField.value : null;

        if (!hashedPassword) {
            console.warn(`[LOGIN] User ${email} found but password field is empty in GHL.`);
            return res.status(401).json({ 
                success: false, 
                message: 'Account found but no password set. Please use the Registration form to set your password.',
                needsRegistration: true 
            });
        }

        const isMatch = await bcrypt.compare(password, hashedPassword);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Invalid credentials. If you forgot your password, please contact the administrator.' });
        }

        // GENERATE JWT TOKEN
        const token = jwt.sign(
            { id: user.id, email: user.email, name: user.firstName },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        return res.json({
            success: true,
            message: 'Login successful',
            user: {
                id: user.id,
                name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
                email: user.email
            },
            token: token
        });

    } catch (error) {
        console.error('[LOGIN ERROR]:', (error.response && error.response.data) || error.message);
        res.status(500).json({ success: false, message: 'Error during login process' });
    }
});

// Signup Endpoint
// Signup Route - Supports /api/signup and /hlgp/api/signup
app.post(['/api/signup', '/hlgp/api/signup'], async (req, res) => {
    const { name, email, company, password } = req.body;

    if (!email || !name || !password) {
        return res.status(400).json({ success: false, message: 'Name, Email, and Password are required' });
    }

    try {
        console.log(`[SIGNUP] Registering: ${email}`);

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Check if user already exists
        const searchResponse = await axios.get(`https://services.leadconnectorhq.com/contacts/`, {
            params: { locationId: GHL_LOCATION_ID, query: email },
            headers: {
                'Authorization': `Bearer ${GHL_API_KEY}`,
                'Version': '2021-07-28',
                'Accept': 'application/json'
            }
        });

        const contacts = searchResponse.data.contacts || [];
        const existingUser = contacts.find(c => c.email && c.email.toLowerCase() === email.toLowerCase());

        if (existingUser) {
            const customFields = existingUser.customFields || [];
            const passwordField = customFields.find(f => f.id === PASSWORD_FIELD_ID || f.key === PASSWORD_FIELD_ID);
            
            if (passwordField && passwordField.value) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Email already registered with a password. Please login or contact the administrator for a reset.' 
                });
            }

            // Case: User exists but has no password -> UPDATE existing contact
            console.log(`[SIGNUP] Updating existing contact: ${existingUser.id}`);
            
            // Resolve field ID again just in case it wasn't resolved on startup
            const actualFieldId = await resolveFieldId();

            // Add the audit tag to the existing user
            const existingTags = existingUser.tags || [];
            const newTags = [...new Set([...existingTags, 'audit user'])];

            const updateResponse = await axios.put(`https://services.leadconnectorhq.com/contacts/${existingUser.id}`, {
                tags: newTags,
                customFields: [
                    {
                        id: actualFieldId,
                        value: hashedPassword
                    }
                ]
            }, {
                headers: {
                    'Authorization': `Bearer ${GHL_API_KEY}`,
                    'Version': '2021-07-28',
                    'Content-Type': 'application/json'
                }
            });

            const updatedUser = updateResponse.data.contact;
            const token = jwt.sign(
                { id: updatedUser.id, email: updatedUser.email, name: updatedUser.firstName },
                JWT_SECRET,
                { expiresIn: '24h' }
            );

            return res.json({
                success: true,
                message: 'Password set successfully for existing account.',
                user: {
                    id: updatedUser.id,
                    name: `${updatedUser.firstName} ${updatedUser.lastName}`.trim(),
                    email: updatedUser.email
                },
                token: token
            });
        }

        // Case: User does not exist -> CREATE new contact
        const [firstName, ...lastNameParts] = name.split(' ');
        const lastName = lastNameParts.join(' ');
        const actualFieldId = await resolveFieldId();

        const createResponse = await axios.post(`https://services.leadconnectorhq.com/contacts/`, {
            locationId: GHL_LOCATION_ID,
            email: email,
            firstName: firstName,
            lastName: lastName || '.',
            companyName: company || 'New Audit Entity',
            tags: ['audit user'],
            customFields: [
                {
                    id: actualFieldId,
                    value: hashedPassword
                }
            ]
        }, {
            headers: {
                'Authorization': `Bearer ${GHL_API_KEY}`,
                'Version': '2021-07-28',
                'Content-Type': 'application/json'
            }
        });

        const newUser = createResponse.data.contact;
        
        // GENERATE JWT TOKEN
        const token = jwt.sign(
            { id: newUser.id, email: newUser.email, name: newUser.firstName },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            success: true,
            message: 'Registration successful',
            user: {
                id: newUser.id,
                name: `${newUser.firstName} ${newUser.lastName}`.trim(),
                email: newUser.email
            },
            token: token
        });

    } catch (error) {
        console.error('[SIGNUP ERROR]:', (error.response && error.response.data) || error.message);
        res.status(500).json({ success: false, message: 'Error creating audit account' });
    }
});

// Forgot Password / Contact Admin Endpoint
// Forgot Password Route - Supports /api/forgot-password and /hlgp/api/forgot-password
app.post(['/api/forgot-password', '/hlgp/api/forgot-password'], async (req, res) => {
    const { email } = req.body;
    
    if (!email) {
        return res.status(400).json({ success: false, message: 'Email is required' });
    }

    try {
        // We still check GHL to verify they are a contact
        const response = await axios.get(`https://services.leadconnectorhq.com/contacts/`, {
            params: { locationId: GHL_LOCATION_ID, query: email },
            headers: {
                'Authorization': `Bearer ${GHL_API_KEY}`,
                'Version': '2021-07-28',
                'Accept': 'application/json'
            }
        });

        const contacts = response.data.contacts || [];
        const userExists = contacts.some(c => c.email && c.email.toLowerCase() === email.toLowerCase());

        if (!userExists) {
            return res.json({ 
                success: false, 
                message: 'No account found with this email. Please register for access.' 
            });
        }

        // Return the admin contact instruction
        return res.json({
            success: true,
            message: 'Account verified. Please contact your AUSTRAC Review Administrator at compliance@centinl.com to reset your password.'
        });

    } catch (error) {
        console.error('[FORGOT PASSWORD ERROR]:', (error.response && error.response.data) || error.message);
        res.status(500).json({ success: false, message: 'Error verifying account.' });
    }
});

// Serve frontend pages for cleaner URLs
// Using regex to handle various prefixes
app.get(['/', '/hlgp', '/audit', '/v2'], (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/auth.html'));
});

// Use regex to capture any path ending in /auth, /auth.html, or /login-page
app.get(/.*\/(auth|login-page)(\.html)?$/, (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/auth.html'));
});

// Use regex to capture any path ending in /audit or /audit.html
app.get(/.*\/audit(\.html)?$/, (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/audit.html'));
});

const server = app.listen(PORT, () => {
    console.log(`🚀 Audit Portal Backend running on port ${PORT}`);
});

// Graceful shutdown handlers to prevent "Can't acquire lock" / zombie process issues
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });
});

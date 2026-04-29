require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5001;
const GHL_API_KEY = process.env.GHL_API_KEY;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID;

// Simple Login Endpoint (v2)
app.post('/api/login', async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ success: false, message: 'Email is required' });
    }

    try {
        console.log(`[LOGIN] Verifying: ${email} | Location: ${GHL_LOCATION_ID}`);

        if (!GHL_API_KEY || !GHL_LOCATION_ID) {
            throw new Error('Server configuration error: GHL_API_KEY or GHL_LOCATION_ID is missing');
        }

        const response = await axios.get(`https://services.leadconnectorhq.com/contacts/`, {
            params: { 
                locationId: GHL_LOCATION_ID.trim(),
                query: email 
            },
            headers: {
                'Authorization': `Bearer ${GHL_API_KEY.trim()}`,
                'Version': '2021-07-28',
                'Accept': 'application/json'
            }
        });

        const contacts = response.data.contacts || [];
        
        if (contacts.length > 0) {
            const user = contacts.find(c => c.email && c.email.toLowerCase() === email.toLowerCase()) || contacts[0];
            
            return res.json({
                success: true,
                message: 'Login successful',
                user: {
                    id: user.id,
                    name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
                    email: user.email,
                    locationId: user.locationId
                },
                token: `ghl_v2_session_${Date.now()}`
            });
        } else {
            return res.status(401).json({ success: false, message: 'User not found in GHL' });
        }

    } catch (error) {
        const errorData = error.response?.data || error.message;
        console.error('[GHL ERROR]:', JSON.stringify(errorData, null, 2));
        
        // Return detailed error for debugging
        res.status(500).json({ 
            success: false, 
            message: 'Error connecting to GHL',
            debug: errorData
        });
    }
});

// Signup Endpoint (Create Contact in GHL)
app.post('/api/signup', async (req, res) => {
    const { name, email, company } = req.body;

    if (!email || !name) {
        return res.status(400).json({ success: false, message: 'Name and Email are required' });
    }

    try {
        console.log(`Registering new user: ${email} for Location: ${GHL_LOCATION_ID}...`);

        // First, check if contact already exists
        const searchResponse = await axios.get(`https://services.leadconnectorhq.com/contacts/`, {
            params: { locationId: GHL_LOCATION_ID, query: email },
            headers: {
                'Authorization': `Bearer ${GHL_API_KEY}`,
                'Version': '2021-07-28',
                'Accept': 'application/json'
            }
        });

        if (searchResponse.data.contacts?.length > 0) {
            return res.status(400).json({ success: false, message: 'Entity already registered. Please Login.' });
        }

        // Create new contact in GHL
        const [firstName, ...lastNameParts] = name.split(' ');
        const lastName = lastNameParts.join(' ');

        const createResponse = await axios.post(`https://services.leadconnectorhq.com/contacts/`, {
            locationId: GHL_LOCATION_ID,
            email: email,
            firstName: firstName,
            lastName: lastName || '.',
            companyName: company || 'New Entity',
            tags: ['Audit Member']
        }, {
            headers: {
                'Authorization': `Bearer ${GHL_API_KEY}`,
                'Version': '2021-07-28',
                'Content-Type': 'application/json'
            }
        });

        const newUser = createResponse.data.contact;
        console.log('User created successfully in GHL!');

        res.json({
            success: true,
            message: 'Registration successful',
            user: {
                id: newUser.id,
                name: `${newUser.firstName} ${newUser.lastName}`.trim(),
                email: newUser.email
            },
            token: `ghl_v2_session_${Date.now()}`
        });

    } catch (error) {
        console.error('Signup Error:', error.response?.data || error.message);
        res.status(500).json({ success: false, message: 'Error registering user in GHL' });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Standalone Login & Signup Backend (v2) running on port ${PORT}`);
});

const axios = require('axios');
require('dotenv').config();

async function testGHL() {
    try {
        console.log("Fetching contacts from GHL...");
        const response = await axios.get(`https://services.leadconnectorhq.com/contacts/`, {
            params: { 
                locationId: process.env.GHL_LOCATION_ID,
                limit: 5 // Get 5 most recent
            },
            headers: {
                'Authorization': `Bearer ${process.env.GHL_API_KEY}`,
                'Version': '2021-07-28',
                'Accept': 'application/json'
            }
        });

        console.log("SUCCESS! Found contacts:", response.data.contacts.map(c => ({
            id: c.id,
            email: c.email,
            name: `${c.firstName} ${c.lastName}`,
            tags: c.tags
        })));
    } catch (err) {
        console.error("GHL API Error:", err.response ? err.response.data : err.message);
    }
}

testGHL();

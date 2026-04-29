const axios = require('axios');

async function test() {
    try {
        const response = await axios.post('http://localhost:5001/api/login', {
            email: 'priya@pivot2thrive.com.au'
        });
        console.log('SUCCESS:', response.data);
    } catch (error) {
        console.log('ERROR:', error.response?.status, error.response?.data);
    }
}

test();

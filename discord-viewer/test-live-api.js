// Test the live API endpoints

async function testAPI() {
  console.log('Testing Live API Endpoints...\n');
  
  // Test 1: Get all prices
  console.log('1. Testing /api/live/all:');
  try {
    const res = await fetch('http://localhost:7878/api/live/all');
    const data = await res.text();
    console.log('Response:', data);
    if (data) {
      const parsed = JSON.parse(data);
      console.log('Parsed:', JSON.stringify(parsed, null, 2));
    }
  } catch (e) {
    console.error('Error:', e.message);
  }
  
  // Test 2: Get specific prices
  console.log('\n2. Testing /api/live/prices?symbols=SNGX:');
  try {
    const res = await fetch('http://localhost:7878/api/live/prices?symbols=SNGX');
    const data = await res.text();
    console.log('Response:', data);
    if (data) {
      const parsed = JSON.parse(data);
      console.log('Parsed:', JSON.stringify(parsed, null, 2));
    }
  } catch (e) {
    console.error('Error:', e.message);
  }
  
  // Test 3: Check raw response
  console.log('\n3. Checking server is running:');
  try {
    const res = await fetch('http://localhost:7878/');
    const data = await res.text();
    console.log('Root response:', data);
  } catch (e) {
    console.error('Error:', e.message);
  }
}

testAPI();

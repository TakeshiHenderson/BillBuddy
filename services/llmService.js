const { GoogleGenerativeAI } = require('@google/generative-ai');

// Initialize Gemini API
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

exports.processBillText = async (text) => {
    console.log('\n=== Starting Bill Text Processing ===');
    console.log('Input text:', text);

    const model = genAI.getGenerativeModel({ 
        model: "gemini-2.5-flash-preview-04-17",
        generationConfig: {
            temperature: 0.1,
            topP: 0.8,
            topK: 40,
            maxOutputTokens: 4096,
        }
    });

    const prompt = `Parse this receipt into a JSON object. Each item line has format: "quantity NAME @ unit_price total_price"
        FYI : The character recognized is not perfect yet
        Rules:
        1. Extract items with quantity, name, and total price
        2. Remove commas from numbers (e.g., "24,500" → 24500)
        3. Use the last number on each line as the total price, Consider the minus value in the receipt, that can be considered as the discount per item
            then subtract it directly and distribute is for each item if the quantity is more than one, i want you to focus to the minus value also and for the distributing the discount among the item
        4. Ignore non-item lines (headers, totals, etc.)
        5. Also complete the missing part in the tesxt

        Required output format (copy this exact structure):
        {
            "items": [
                {
                    "name": "AYAM KREMES",
                    "quantity": 1,
                    "price": 24500
                }
            ],
            "tax": 0,
            "service": 0,
            "discount": 0
        }

        Receipt to parse:
        ${text}

        Respond with ONLY the JSON object, no other text.`;

    const maxRetries = 3; // Number of retry attempts
    const retryDelay = 1000; // Delay in milliseconds between retries
    let response = null;

    for (let i = 0; i < maxRetries; i++) {
        try {
            console.log(`\n=== Getting Response from Gemini (Attempt ${i + 1}/${maxRetries}) ===`);
            const result = await model.generateContent(prompt);
            response = result.response.text();
            
            console.log('Gemini Response:', response);

            if (response && response.trim() !== '') {
                console.log('✅ Valid response received.');
                break; // Exit loop if response is valid
            } else {
                console.warn('⚠️ Received empty or invalid response from Gemini. Retrying...');
            }
        } catch (error) {
            console.error(`❌ Error during Gemini API call (Attempt ${i + 1}/${maxRetries}):`, error);
            if (i < maxRetries - 1) {
                console.log(`Waiting ${retryDelay}ms before retrying...`);
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            } else {
                console.error('❌ Max retries reached. Failing.');
                throw new Error('Failed to get response from Gemini after multiple retries');
            }
        }
    }

    // If response is still empty after retries, throw an error
    if (!response || response.trim() === '') {
        console.error('\n=== Error: Final Empty Response After Retries ===');
        console.error('Gemini returned empty response after all retry attempts.');
        return {
            success: false,
            error: 'Failed to process bill text after multiple retries'
        };
    }

    // Parse the JSON response
    try {
        console.log('\n=== Processing Response ===');
        // Clean the response to ensure it's valid JSON
        const cleanedResponse = response.trim().replace(/^```json\n?|\n?```$/g, '');
        console.log('Cleaned Response:', cleanedResponse);
        
        // If cleaned response is empty, return error
        if (!cleanedResponse || cleanedResponse.trim() === '') {
            console.error('\n=== Error: Empty Cleaned Response After Cleaning ===');
            console.error('Response was empty after cleaning.');
            return {
                success: false,
                error: 'Failed to process bill text: Cleaned response was empty'
            };
        }
        
        // Try to fix incomplete JSON
        let fixedResponse = cleanedResponse;
        
        // If the response is incomplete, try to fix it
        if (!cleanedResponse.endsWith('}')) {
            console.log('\n=== Fixing Incomplete Response ===');
            // If we have items but they're incomplete
            if (cleanedResponse.includes('"items": [')) {
                // If the items array is incomplete
                if (!cleanedResponse.includes(']')) {
                    console.log('Items array is incomplete, finding last complete item...');
                    // Find the last complete item
                    const lastCompleteItem = cleanedResponse.match(/\{[^}]*\}/g);
                    if (lastCompleteItem) {
                        console.log('Found complete items:', lastCompleteItem);
                        // Reconstruct the JSON with the last complete item
                        fixedResponse = cleanedResponse.substring(0, cleanedResponse.lastIndexOf(lastCompleteItem[lastCompleteItem.length - 1]) + lastCompleteItem[lastCompleteItem.length - 1].length) + ']';
                    }
                }
                // Add the closing brackets and default values
                fixedResponse = fixedResponse + ', "tax": 0, "service": 0, "discount": 0}';
            }
        }

        console.log('Fixed Response:', fixedResponse);
        
        // Validate JSON structure before parsing
        if (!fixedResponse.startsWith('{') || !fixedResponse.endsWith('}')) {
            throw new Error('Invalid JSON structure after fixing');
        }

        const parsedResponse = JSON.parse(fixedResponse);
        console.log('Parsed Response:', parsedResponse);

        // Validate the parsed data
        if (!parsedResponse.items || !Array.isArray(parsedResponse.items)) {
            throw new Error('Response does not contain valid items array after parsing');
        }

        // Validate each item
        const validatedItems = parsedResponse.items.filter(item => {
            const isValid = (
                typeof item === 'object' &&
                typeof item.name === 'string' &&
                typeof item.quantity === 'number' &&
                typeof item.price === 'number' &&
                item.quantity > 0 &&
                item.price > 0
            );
            if (!isValid) {
                console.log('Invalid item found during validation:', item);
            }
            return isValid;
        });

        if (validatedItems.length === 0) {
            throw new Error('No valid items found in response after validation');
        }

        // Ensure tax, service, and discount are numbers
        const validatedResponse = {
            items: validatedItems,
            tax: Number(parsedResponse.tax) || 0,
            service: Number(parsedResponse.service) || 0,
            discount: Number(parsedResponse.discount) || 0
        };

        console.log('\n=== Final Result ===');
        console.log('Validated Response:', validatedResponse);

        return {
            success: true,
            ...validatedResponse
        };
    } catch (parseError) {
        console.error('\n=== Error: Failed to Parse or Validate Response ===');
        console.error('Parse/Validation Error:', parseError);
        console.error('Raw Response received before parsing:', response);
        
        // Use fallback parsing if available
        console.log('\n=== Attempting Fallback Parsing ===');
        const items = [];
        const lines = text.split('\n');
        
        for (const line of lines) {
            const match = line.match(/(\d+)x\s+@\s*(\d+\.?\d*)\s+(\d+\.?\d*)/);
            if (match) {
                const [, quantity, , totalPrice] = match;
                const name = line.split('@')[0].replace(/\d+x\s*/, '').trim();
                items.push({
                    name,
                    quantity: parseInt(quantity),
                    price: parseInt(totalPrice.replace(/\./g, ''))
                });
            }
        }
        
        if (items.length > 0) {
            console.log('Fallback Parsing Successful:', items);
            return {
                success: true,
                items,
                tax: 0,
                service: 0,
                discount: 0
            };
        }
        
        return {
            success: false,
            error: 'Failed to parse or validate Gemini response and fallback failed'
        };
    }
}; 
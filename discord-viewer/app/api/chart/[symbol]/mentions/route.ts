import { NextRequest, NextResponse } from 'next/server';

interface TraderMention {
  messageId: string;
  timestamp: string;
  authorName: string;
  authorNickname: string | null;
  authorAvatarUrl: string;
  price: number | null;
  content: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: { symbol: string } }
) {
  try {
    const { symbol } = params;
    const searchParams = request.nextUrl.searchParams;
    const date = searchParams.get('date') || new Date().toISOString().split('T')[0];
    
    console.log(`Fetching trader mentions for ${symbol} on ${date}`);
    
    // First, get all messages for this ticker from the messages API
    const baseUrl = process.env.NODE_ENV === 'production' 
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN || process.env.VERCEL_URL || request.headers.get('host')}` 
      : request.nextUrl.origin;
    const messagesUrl = `${baseUrl}/api/messages-v2?ticker=${symbol}`;
    console.log(`Calling messages API: ${messagesUrl}`);
    
    const messagesResponse = await fetch(messagesUrl, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    });
    
    console.log(`Messages API response status: ${messagesResponse.status}`);
    
    if (!messagesResponse.ok) {
      const errorText = await messagesResponse.text();
      console.error(`Messages API error: ${errorText}`);
      
      // Return empty array instead of throwing error to prevent breaking the chart
      console.log(`Returning empty mentions due to API error`);
      return NextResponse.json([]);
    }
    
    const messagesData = await messagesResponse.json();
    const messages = messagesData.messages || [];
    
    console.log(`Total messages from API: ${messages.length}`);
    
    // Filter messages for today only to match chart data - handle UTC properly
    const startOfDay = new Date(`${date}T00:00:00.000Z`);
    const endOfDay = new Date(`${date}T23:59:59.999Z`);
    
    console.log(`Date param: ${date}`);
    console.log(`Filtering messages between ${startOfDay.toISOString()} and ${endOfDay.toISOString()}`);
    console.log(`Sample message timestamps:`, messages.slice(0, 3).map((m: any) => ({id: m.id, timestamp: m.timestamp})));
    
    const todayMessages = messages.filter((message: any) => {
      const messageDate = new Date(message.timestamp);
      const isToday = messageDate >= startOfDay && messageDate <= endOfDay;
      if (!isToday && messages.indexOf(message) < 5) {
        console.log(`Message ${message.id} from ${messageDate.toISOString()} is NOT today (range: ${startOfDay.toISOString()} to ${endOfDay.toISOString()})`);
      }
      return isToday;
    });
    
    console.log(`Found ${todayMessages.length} messages for today out of ${messages.length} total`);
    
    if (todayMessages.length === 0) {
      console.log(`No messages found for ${symbol} on ${date}`);
      return NextResponse.json([]);
    }
    
    // Limit to recent messages to avoid too much processing  
    const messagesToProcess = todayMessages.slice(0, 20);
    console.log(`Processing ${messagesToProcess.length} messages from today`);
    
    // Get prices for each message
    const mentions: TraderMention[] = [];
    
    // Process messages in smaller batches to avoid overwhelming the price API
    const batchSize = 5;
    for (let i = 0; i < messagesToProcess.length; i += batchSize) {
      const batch = messagesToProcess.slice(i, i + batchSize);
      
      await Promise.all(batch.map(async (message) => {
        try {
          const isoTimestamp = new Date(message.timestamp).toISOString();
          const priceUrl = `${baseUrl}/api/databento?symbol=${symbol}&timestamp=${isoTimestamp}`;
          
          console.log(`Fetching price for message ${message.id} at ${isoTimestamp}`);
          
          const priceResponse = await fetch(priceUrl, {
            headers: {
              'Accept': 'application/json',
            },
          });
          
          let price = null;
          if (priceResponse.ok) {
            const priceData = await priceResponse.json();
            price = priceData.price && priceData.price > 0 ? priceData.price : null;
            console.log(`Got price ${price} for message ${message.id}`);
          } else {
            console.log(`Price API failed for message ${message.id}: ${priceResponse.status}`);
          }
          
          mentions.push({
            messageId: message.id,
            timestamp: message.timestamp,
            authorName: message.author_name,
            authorNickname: message.author_nickname || message.author_name,
            authorAvatarUrl: message.author_avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(message.author_name)}&background=ff6b35&color=fff&size=40`,
            price: price,
            content: message.content.substring(0, 150) + (message.content.length > 150 ? '...' : '')
          });
        } catch (error) {
          console.error(`Error processing message ${message.id}:`, error);
          // Include the mention even without price data
          mentions.push({
            messageId: message.id,
            timestamp: message.timestamp,
            authorName: message.author_name,
            authorNickname: message.author_nickname || message.author_name,
            authorAvatarUrl: message.author_avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(message.author_name)}&background=ff6b35&color=fff&size=40`,
            price: null,
            content: message.content.substring(0, 150) + (message.content.length > 150 ? '...' : '')
          });
        }
      }));
    }
    
    // Sort by timestamp
    mentions.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    
    // If no real mentions found, return empty array
    if (mentions.length === 0) {
      console.log(`No real trader mentions found for ${symbol} on ${date}`);
      return NextResponse.json([]);
    }
    
    console.log(`Returning ${mentions.length} trader mentions`);
    return NextResponse.json(mentions);
    
  } catch (error) {
    console.error('Error fetching trader mentions:', error);
    return NextResponse.json(
      { 
        error: 'Failed to fetch trader mentions',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
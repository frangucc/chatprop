import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  request: NextRequest,
  { params }: { params: { dimensions: string[] } }
) {
  try {
    // Parse dimensions from URL path
    const dimensions = params.dimensions;
    let width = 40;
    let height = 40;
    
    if (dimensions && dimensions.length >= 1) {
      width = parseInt(dimensions[0]) || 40;
    }
    if (dimensions && dimensions.length >= 2) {
      height = parseInt(dimensions[1]) || width; // Default to square if only width provided
    }
    
    // Clamp dimensions to reasonable limits
    width = Math.max(16, Math.min(512, width));
    height = Math.max(16, Math.min(512, height));
    
    // Generate a simple SVG placeholder
    const svg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#e5e7eb"/>
        <circle cx="${width/2}" cy="${height/2 - 5}" r="${Math.min(width, height) * 0.25}" fill="#9ca3af"/>
        <path d="M${width * 0.25} ${height * 0.75} Q${width/2} ${height * 0.6} ${width * 0.75} ${height * 0.75} L${width * 0.75} ${height} L${width * 0.25} ${height} Z" fill="#9ca3af"/>
      </svg>
    `.trim();
    
    return new NextResponse(svg, {
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
      },
    });
  } catch (error) {
    console.error('Error generating placeholder:', error);
    
    // Return a minimal fallback SVG
    const fallbackSvg = `
      <svg width="40" height="40" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#e5e7eb"/>
      </svg>
    `;
    
    return new NextResponse(fallbackSvg, {
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=31536000',
      },
    });
  }
}

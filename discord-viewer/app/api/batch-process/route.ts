import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';

// Store active batch process
let activeBatchProcess: any = null;
let batchStatus = {
  running: false,
  startTime: null,
  progress: 0,
  totalMessages: 0,
  processedMessages: 0,
  newTickers: 0,
  errors: 0
};

export async function POST(request: NextRequest) {
  try {
    if (activeBatchProcess && batchStatus.running) {
      return NextResponse.json({ 
        error: 'Batch process already running',
        status: batchStatus 
      }, { status: 409 });
    }

    // Start batch processing
    const scriptPath = path.join(process.cwd(), 'batch-process-today.js');
    activeBatchProcess = spawn('node', [scriptPath], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe']
    });

    batchStatus = {
      running: true,
      startTime: new Date().toISOString(),
      progress: 0,
      totalMessages: 0,
      processedMessages: 0,
      newTickers: 0,
      errors: 0
    };

    // Handle process completion
    activeBatchProcess.on('close', (code: number) => {
      batchStatus.running = false;
      activeBatchProcess = null;
      console.log(`Batch process completed with code: ${code}`);
    });

    // Handle process errors
    activeBatchProcess.on('error', (error: Error) => {
      console.error('Batch process error:', error);
      batchStatus.running = false;
      batchStatus.errors++;
      activeBatchProcess = null;
    });

    return NextResponse.json({ 
      success: true, 
      message: 'Batch processing started',
      status: batchStatus
    });

  } catch (error) {
    console.error('Error starting batch process:', error);
    return NextResponse.json(
      { error: 'Failed to start batch process' },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ status: batchStatus });
}

export async function DELETE() {
  try {
    if (activeBatchProcess && batchStatus.running) {
      activeBatchProcess.kill('SIGTERM');
      batchStatus.running = false;
      activeBatchProcess = null;
      return NextResponse.json({ success: true, message: 'Batch process stopped' });
    }
    
    return NextResponse.json({ error: 'No active batch process' }, { status: 404 });
  } catch (error) {
    console.error('Error stopping batch process:', error);
    return NextResponse.json(
      { error: 'Failed to stop batch process' },
      { status: 500 }
    );
  }
}

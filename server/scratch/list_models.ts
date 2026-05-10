import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function list() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.error('No GEMINI_API_KEY found in .env');
    return;
  }
  try {
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
    const data = await resp.json();
    if (data.models) {
      console.log('Available Models:');
      data.models.forEach((m: any) => {
         if (m.name.includes('gemma')) {
           console.log(`- ${m.name}`);
         }
      });
    } else {
      console.log(JSON.stringify(data, null, 2));
    }
  } catch (e) {
    console.error(e);
  }
}

list();

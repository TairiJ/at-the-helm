import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

const ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

async function test() {
  try {
    const model = ai.getGenerativeModel({model: 'gemini-2.5-flash'});
    const res = await model.generateContentStream('hello');
    for await (const chunk of res.stream) {
        console.log(chunk.text());
    }
  } catch (e) {
    console.error('ERROR:', e);
  }
}
test();

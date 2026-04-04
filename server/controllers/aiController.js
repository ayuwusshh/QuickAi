import sql from "../configs/db.js";
import { clerkClient } from "@clerk/express";
import axios from "axios";
import OpenAI from "openai";
import { v2 as cloudinary } from 'cloudinary'
import FormData from 'form-data';
import fs from 'fs'
import pdf from 'pdf-parse/lib/pdf-parse.js'
const AI = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY,
  baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/"
});
export const generateArticle = async (req, res) => {
  try {
    const { userId } = req.auth();
    const { prompt, length } = req.body;
    const plan = req.plan;
    const free_usage = req.free_usage;

    if (plan !== 'premium' && free_usage >= 100) {
      return res.json({ success: false, message: "Limit reached. Upgrade to continue." });
    }
    const response = await AI.chat.completions.create({
      model: "gemini-2.5-flash-lite",
      messages: [{ role: "user", content: prompt, }],
      temperature: 0.7,
      max_tokens: 2000
    });

    const content = response.choices[0].message.content

    await sql`INSERT INTO creations (user_id, prompt, content, type) VALUES (${userId}, ${prompt}, ${content}, 'article')`;

    if (plan !== 'premium') {
      await clerkClient.users.updateUserMetadata(userId, {
        privateMetadata: {
          free_usage: free_usage + 1
        }
      });
    }

    res.json({ success: true, content });
  } catch (error) {
    console.log(error.message);
    res.json({ success: false, message: error.message });
  }
}
export const generateBlogTitle = async (req, res) => {
  try {
    const { userId } = req.auth();
    const { prompt } = req.body;
    const plan = req.plan;
    const free_usage = req.free_usage;

    if (plan !== 'premium' && free_usage >= 100) {
      return res.json({ success: false, message: "Limit reached. Upgrade to continue." });
    }
    let response;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        console.log(`Blog title attempt ${attempt + 1}, model: gemini-2.5-flash-lite`);
        response = await AI.chat.completions.create({
          model: "gemini-2.5-flash-lite",
          messages: [{ role: "user", content: prompt, }],
          temperature: 0.7,
          max_tokens: 100
        });
        break;
      } catch (err) {
        console.log(`Attempt ${attempt + 1} failed:`, err.status, err.message);
        if (err.status === 429 && attempt < 3) {
          const delay = Math.pow(2, attempt + 1) * 3000; // 6s, 12s, 24s
          console.log(`Rate limited. Waiting ${delay}ms before retry...`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw err;
      }
    }

    const content = response.choices[0].message.content

    await sql`INSERT INTO creations (user_id, prompt, content, type) VALUES (${userId}, ${prompt}, ${content}, 'blog-title')`;

    if (plan !== 'premium') {
      await clerkClient.users.updateUserMetadata(userId, {
        privateMetadata: {
          free_usage: free_usage + 1
        }
      });
    }
    res.json({ success: true, content });
  } catch (error) {
    console.log('generateBlogTitle error:', error.status, error.message);
    res.json({ success: false, message: error.message });
  }
}
export const generateImage = async (req, res) => {
  try {
    const { userId } = req.auth();
    const { prompt, publish } = req.body;
    const plan = req.plan;
    const free_usage = req.free_usage;

    if (plan !== 'premium' && free_usage > 10) {
      return res.json({ success: false, message: "Limit reached. Upgrade to continue." });
    }
    const formData = new FormData()
    formData.append('prompt', prompt)
    const { data } = await axios.post("https://clipdrop-api.co/text-to-image/v1", formData, {
      headers: { 'x-api-key': process.env.CLIPDROP_API_KEY },
      responseType: "arraybuffer",
    })

    const base64Image = `data:image/png;base64,${Buffer.from(data, 'binary').toString('base64')}`

    const { secure_url } = await cloudinary.uploader.upload(base64Image)

    await sql`INSERT INTO creations (user_id, prompt, content, type,publish) VALUES (${userId}, ${prompt}, ${secure_url}, 'image', ${publish ?? false})`;

    if (plan !== 'premium') {
      await clerkClient.users.updateUserMetadata(userId, {
        privateMetadata: {
          free_usage: free_usage + 1
        }
      });
    }

    res.json({ success: true, content: secure_url });
  } catch (error) {
    console.log(error.message);
    res.json({ success: false, message: error.message });
  }
}
export const removeImageBackground = async (req, res) => {
  try {
    const { userId } = req.auth();
    const image = req.file;
    const plan = req.plan;
    const free_usage = req.free_usage;

    if (plan !== 'premium' && free_usage >= 10) {
      return res.json({ success: false, message: "Limit reached. Upgrade to continue." });
    }

    const { secure_url } = await cloudinary.uploader.upload(image.path, {
      transformation: [
        {
          effect: 'background_removal',
          background_removal: 'remove_the_background'
        }
      ]
    })

    await sql`INSERT INTO creations (user_id, prompt, content, type) VALUES (${userId}, 'Remove background from image', ${secure_url}, 'image')`;


    if (plan !== 'premium') {
      await clerkClient.users.updateUserMetadata(userId, {
        privateMetadata: {
          free_usage: free_usage + 1
        }
      });
    }

    res.json({ success: true, content: secure_url });
  } catch (error) {
    console.log(error.message);
    res.json({ success: false, message: error.message });
  }
}
export const removeImageObject = async (req, res) => {
  try {
    const { userId } = req.auth();
    const { object } = req.body;
    const image = req.file;
    const plan = req.plan;
    const free_usage = req.free_usage;

    if (plan !== 'premium' && free_usage >= 10) {
      return res.json({ success: false, message: "Limit reached. Upgrade to continue." });
    }

    const { public_id } = await cloudinary.uploader.upload(image.path)
    const imageUrl = cloudinary.url(public_id, {
      transformation: [{ effect: `gen_remove:${object}` }],
      resource_type: 'image'
    })

    await sql` INSERT INTO creations (user_id, prompt, content, type) VALUES (${userId}, ${`Removed ${object} from image`}, ${imageUrl}, 'image')`;


    if (plan !== 'premium') {
      await clerkClient.users.updateUserMetadata(userId, {
        privateMetadata: {
          free_usage: free_usage + 1
        }
      });
    }

    res.json({ success: true, content: imageUrl });
  } catch (error) {
    console.log(error.message);
    res.json({ success: false, message: error.message });
  }
}
export const resumeReview = async (req, res) => {
  try {
    const { userId } = req.auth();
    const resume = req.file;
    const plan = req.plan;
    const free_usage = req.free_usage;

    if (plan !== 'premium' && free_usage >= 10) {
      return res.json({ success: false, message: "Limit reached. Upgrade to continue." });
    }

    if (resume.size > 5 * 1024 * 1024) {
      return res.json({ success: false, message: "Resume file size exceeds allowed size (5MB)." })
    }
    const dataBuffer = fs.readFileSync(resume.path)
    const pdfData = await pdf(dataBuffer)

    const prompt = `Review the following resume and provide constructive feedback on its strengths,weaknesses and areas for improvements. Resume Content:\n\n ${pdfData.text}`

    let response;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        console.log(`Resume review attempt ${attempt + 1}, model: gemini-2.5-flash-lite`);
        response = await AI.chat.completions.create({
          model: "gemini-2.5-flash-lite",
          messages: [{ role: "user", content: prompt, }],
          temperature: 0.7,
          max_tokens: 1000
        });
        break;
      } catch (err) {
        console.log(`Attempt ${attempt + 1} failed:`, err.status, err.message);
        if (err.status === 429 && attempt < 3) {
          const delay = Math.pow(2, attempt + 1) * 3000;
          console.log(`Rate limited. Waiting ${delay}ms before retry...`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw err;
      }
    }

    const content = response.choices[0].message.content

    await sql`INSERT INTO creations (user_id, prompt, content, type) VALUES (${userId}, 'Review the uploaded resume', ${content}, 'resume-review')`;

    if (plan !== 'premium') {
      await clerkClient.users.updateUserMetadata(userId, {
        privateMetadata: {
          free_usage: free_usage + 1
        }
      });
    }

    res.json({ success: true, content });
  } catch (error) {
    console.log(error.message);
    res.json({ success: false, message: error.message });
  }
}
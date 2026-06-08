import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getOAuth2Client } from '@/lib/youtube';
import { getConfig } from '@/lib/config';
import { GoogleGenAI } from '@google/genai';
import { google } from 'googleapis';

export async function POST(request) {
  try {
    const { youtubeVideoId, language = 'Spanish' } = await request.json();

    if (!youtubeVideoId) {
      return NextResponse.json({ error: 'Missing youtubeVideoId parameter' }, { status: 400 });
    }

    const channel = await prisma.channel.findFirst({
      orderBy: { updatedAt: 'desc' }
    });

    if (!channel) {
      return NextResponse.json({ error: 'No YouTube channel connected. Please authenticate first.' }, { status: 400 });
    }

    const oauth2Client = await getOAuth2Client();
    oauth2Client.setCredentials({
      access_token: channel.accessToken,
      refresh_token: channel.refreshToken,
      expiry_date: channel.tokenExpiry.getTime()
    });

    // Refresh token if needed
    if (channel.tokenExpiry.getTime() - Date.now() < 300 * 1000) {
      try {
        const { credentials } = await oauth2Client.refreshAccessToken();
        await prisma.channel.update({
          where: { id: channel.id },
          data: {
            accessToken: credentials.access_token,
            tokenExpiry: new Date(credentials.expiry_date)
          }
        });
      } catch (err) {
        console.error('Error refreshing token in optimize api:', err);
      }
    }

    const youtube = google.youtube({
      version: 'v3',
      auth: oauth2Client
    });

    // Fetch video details from YouTube
    const videoRes = await youtube.videos.list({
      part: 'snippet',
      id: youtubeVideoId
    });

    if (!videoRes.data.items || videoRes.data.items.length === 0) {
      return NextResponse.json({ error: 'Video not found on YouTube' }, { status: 404 });
    }

    const videoItem = videoRes.data.items[0];
    const currentTitle = videoItem.snippet.title;
    const currentDescription = videoItem.snippet.description;
    const currentTags = videoItem.snippet.tags ? videoItem.snippet.tags.join(', ') : '';

    // Initialize Gemini
    const apiKey = await getConfig('GEMINI_API_KEY');
    if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY') {
      return NextResponse.json({ error: 'Gemini API key is not configured' }, { status: 500 });
    }

    const ai = new GoogleGenAI({ apiKey });

    const prompt = `
Analyze the following metadata of an existing YouTube video and optimize it for a professional, high-CTR, and SEO-optimized YouTube upload in the following language: ${language}.

Current Title: ${currentTitle}
Current Description: ${currentDescription}
Current Tags: ${currentTags}

Generate the following:
1. Three options for an attractive title (optimized for high CTR and SEO) in ${language}. CRITICAL: Each title option MUST be under 100 characters in length (YouTube API limit).
2. An engaging description (including key topics, call to action, and placeholder timestamps if applicable) in ${language}.
3. Relevant hashtags (all starting with the '#' symbol, e.g. ["#keyword1", "#keyword2"]) in ${language}.

Respond in JSON format with the following keys:
{
  "titles": ["Title 1", "Title 2", "Title 3"],
  "description": "Suggested description...",
  "tags": ["#tag1", "#tag2", "#tag3"]
}
`;

    console.log(`[Optimize API] Generating optimization suggestions for video ${youtubeVideoId}...`);
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }]
        }
      ],
      config: {
        responseMimeType: 'application/json',
      }
    });

    let metadata;
    try {
      metadata = JSON.parse(response.text);
    } catch (parseError) {
      console.error('Failed to parse Gemini response as JSON. Raw text:', response.text);
      throw new Error('Gemini did not return a valid JSON structure');
    }

    return NextResponse.json({
      success: true,
      current: {
        title: currentTitle,
        description: currentDescription,
        tags: currentTags
      },
      suggestions: {
        titles: metadata.titles || [currentTitle],
        description: metadata.description || '',
        tags: metadata.tags || []
      }
    });

  } catch (error) {
    console.error('Error during video optimization:', error);
    return NextResponse.json({ error: error.message || 'Video optimization failed' }, { status: 500 });
  }
}

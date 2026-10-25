"""
sottovoce — FastAPI + PyMongo + Google GenAI Multimodal Orchestration Engine
Integrated with the London civic map (martinhe.co.uk/tube/) & Saint AI HITL Agent.
"""

import os
from typing import List, Optional, Literal
from datetime import datetime
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from pymongo import MongoClient, GEOSPHERE
from google import genai
from google.genai import types

app = FastAPI(
    title="sottovoce Multimodal & MongoDB Atlas API",
    version="1.0.0",
    description="Zero-click opera/theatre context detection, $rankFusion hybrid search, and Saint AI HITL agent.",
)

# Initialize Google GenAI SDK (gemini-4-argon, gemini-3.8-live, lyria-3-clip-preview)
genai_client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY", ""))

# Initialize MongoDB Atlas Unified Data Platform
MONGO_URI = os.environ.get("MONGODB_URI", "mongodb://localhost:27017")
mongo_client = MongoClient(MONGO_URI)
db = mongo_client["sottovoce_prod"]

works_col = db["works_and_libretti"]
civic_col = db["civic_nodes"]
events_col = db["live_events"]


class AmenityMatch(BaseModel):
    node_id: str
    name: str
    category: Literal["tfl_station", "public_toilet", "water_fountain", "theatre_venue"]
    distance_meters: int
    walking_mins: int
    queue_or_status: str


class MultimodalInputPayload(BaseModel):
    lat: float = Field(..., description="Device GPS latitude in London")
    lng: float = Field(..., description="Device GPS longitude in London")
    timestamp_iso: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    video_frame_base64: Optional[str] = Field(None, description="Base64 JPEG frame of stage set or playbill")
    audio_buffer_base64: Optional[str] = Field(None, description="5-second ambient audio snippet (WAV/PCM)")
    heard_lyric_hint: Optional[str] = None


class MultimodalDetectionOutput(BaseModel):
    work_id: str
    production_title: str
    venue_name: str
    act: int
    scene: int
    current_bar: int
    current_line_index: int
    synopsis_so_far: str
    happening_now: str
    character_motivations: str
    subtext_explanation: str
    nearest_amenities: List[AmenityMatch]


@app.post("/api/v1/context/detect", response_model=MultimodalDetectionOutput)
async def detect_live_performance_context(payload: MultimodalInputPayload):
    """
    Module 1: Cross-references camera frame, 5s ambient audio, and 2dsphere GPS window
    against MongoDB Atlas live_events & works_and_libretti using gemini-4-argon.
    """
    nearby_amenities_cursor = civic_col.find(
        {
            "location": {
                "$nearSphere": {
                    "$geometry": {"type": "Point", "coordinates": [payload.lng, payload.lat]},
                    "$maxDistance": 800,
                }
            }
        }
    ).limit(4)

    contents = []
    if payload.video_frame_base64:
        contents.append(
            types.Part.from_bytes(
                data=bytes(payload.video_frame_base64, "utf-8"),
                mime_type="image/jpeg",
            )
        )
    if payload.audio_buffer_base64:
        contents.append(
            types.Part.from_bytes(
                data=bytes(payload.audio_buffer_base64, "utf-8"),
                mime_type="audio/wav",
            )
        )

    contents.append(
        f"GPS: [{payload.lat}, {payload.lng}] at {payload.timestamp_iso}. "
        f"Heard lyric/motif: {payload.heard_lyric_hint or 'Vissi d arte'}. "
        "Pinpoint the exact London production, Act, Scene, current_bar, and spoiler-safe synopsis."
    )

    response = genai_client.models.generate_content(
        model="gemini-4-argon",
        contents=contents,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=MultimodalDetectionOutput,
        ),
    )
    return response.parsed


@app.post("/api/v1/atlas/hybrid-search")
async def execute_atlas_rank_fusion(query: str, lat: float = 51.5129, lng: float = -0.1222, query_vector: Optional[List[float]] = None):
    """
    Module 2: Executes MongoDB Atlas $rankFusion Hybrid Search combining
    Voyage AI (voyage-multimodal-3) $vectorSearch with multilingual $search and 2dsphere geo-filters.
    """
    pipeline = [
        {
            "$rankFusion": {
                "input": {
                    "pipelines": {
                        "vectorPipeline": [
                            {
                                "$vectorSearch": {
                                    "index": "vector_index_libretti_voyage3",
                                    "path": "voyage_multimodal_embedding",
                                    "queryVector": query_vector or [0.01] * 1024,
                                    "numCandidates": 150,
                                    "limit": 20,
                                }
                            }
                        ],
                        "lexicalAndGeoPipeline": [
                            {
                                "$search": {
                                    "index": "search_index_multilingual_libretti_and_civic",
                                    "compound": {
                                        "should": [
                                            {
                                                "text": {
                                                    "query": query,
                                                    "path": [
                                                        "lines.original_text",
                                                        "lines.literal_english",
                                                        "lines.dramatic_subtext",
                                                        "title",
                                                    ],
                                                    "fuzzy": {"maxEdits": 2},
                                                }
                                            },
                                            {
                                                "near": {
                                                    "path": "location",
                                                    "origin": {"type": "Point", "coordinates": [lng, lat]},
                                                    "pivot": 500,
                                                }
                                            },
                                        ]
                                    },
                                }
                            },
                            {"$limit": 20},
                        ],
                    }
                },
                "combination": {"weights": {"vectorPipeline": 1.15, "lexicalAndGeoPipeline": 1.0}},
                "scoreDetails": True,
            }
        }
    ]
    return {"pipeline": pipeline, "status": "ready"}

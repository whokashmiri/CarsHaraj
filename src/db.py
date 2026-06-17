from __future__ import annotations

from datetime import datetime, UTC
from typing import Any

from motor.motor_asyncio import AsyncIOMotorClient

from .config import settings

_client: AsyncIOMotorClient | None = None


def get_client() -> AsyncIOMotorClient:
    global _client
    if _client is None:
        _client = AsyncIOMotorClient(settings.mongodb_uri)
    return _client


def get_db():
    return get_client()[settings.mongodb_db]


async def ad_exists_by_url_id(url_id: str) -> bool:
    url_id = str(url_id or "").strip()
    if not url_id:
        return False

    return await get_db()["harajTagScrape"].count_documents(
        {"harajUrlId": url_id},
        limit=1,
    ) > 0

def get_collection():
    return get_db()[settings.mongodb_collection]


def normalize_price(formatted_price):
    if formatted_price is None:
        return None
    digits = ''.join(ch for ch in str(formatted_price) if ch.isdigit())
    return int(digits) if digits else None


def extract_post_item(ad: dict[str, Any]) -> dict[str, Any] | None:
    return (((ad.get('gql') or {}).get('posts') or {}).get('json') or {}).get('data', {}).get('posts', {}).get('items', [None])[0]


def normalize_post_item(gql_item: dict[str, Any]) -> dict[str, Any]:
    formatted_price = (gql_item.get('price') or {}).get('formattedPrice') if isinstance(gql_item.get('price'), dict) else None
    numeric_price = normalize_price(formatted_price)
    return {
        'id': gql_item.get('id'),
        'title': gql_item.get('title'),
        'postDate': gql_item.get('postDate'),
        'updateDate': gql_item.get('updateDate'),
        'authorUsername': gql_item.get('authorUsername'),
        'authorId': gql_item.get('authorId'),
        'URL': gql_item.get('URL'),
        'bodyTEXT': gql_item.get('bodyTEXT'),
        'city': gql_item.get('city'),
        'geoCity': gql_item.get('geoCity'),
        'geoNeighborhood': gql_item.get('geoNeighborhood'),
        'tags': gql_item.get('tags') if isinstance(gql_item.get('tags'), list) else [],
        'imagesList': gql_item.get('imagesList') if isinstance(gql_item.get('imagesList'), list) else [],
        'hasImage': gql_item.get('hasImage'),
        'hasVideo': gql_item.get('hasVideo'),
        'commentEnabled': gql_item.get('commentEnabled'),
        'commentStatus': gql_item.get('commentStatus'),
        'commentCount': gql_item.get('commentCount'),
        'status': gql_item.get('status'),
        'postType': gql_item.get('postType'),
        'price': {'formattedPrice': formatted_price, 'numeric': numeric_price},
    }


def extract_comments_items(comments_json: dict[str, Any] | None):
    if not isinstance(comments_json, dict):
        return []
    items = (((comments_json.get('data') or {}).get('comments') or {}).get('items') or [])
    return items if isinstance(items, list) else []


def normalize_comments(items) -> list[dict[str, Any]]:
    if not isinstance(items, list):
        return []
    return [
        {
            'id': c.get('id'),
            'authorUsername': c.get('authorUsername'),
            'authorId': c.get('authorId'),
            'authorLevel': c.get('authorLevel'),
            'body': c.get('body'),
            'status': c.get('status'),
            'deleteReason': c.get('deleteReason'),
            'seqId': c.get('seqId'),
            'date': c.get('date'),
            'isReply': c.get('isReply', False),
            'replyToCommentId': c.get('replyToCommentId', 0),
            'mention': c.get('mention'),
        }
        for c in items
        if isinstance(c, dict)
    ]


def normalize_contact(contact: dict[str, Any] | None) -> dict[str, Any]:
    contact = contact if isinstance(contact, dict) else {}
    return {
        'id': contact.get('id'),
        'username': contact.get('username'),
        'mobile': contact.get('mobile'),
        'email': contact.get('email'),
    }


async def save_ad(ad: dict[str, Any]) -> dict[str, Any]:
    if not ad or ad.get('status') != 'FOUND':
        return {'inserted': False}

    post_id = str(ad.get('postId') or '').strip()
    if not post_id:
        return {'inserted': False}

    gql_item = extract_post_item(ad)
    if not gql_item:
        print(f'[SKIP_DB] item=null, not saving postId={post_id}')
        return {'inserted': False, 'skipped': 'ITEM_NULL'}

    item = normalize_post_item(gql_item)
    comments_json = (((ad.get('gql') or {}).get('comments') or {}).get('json'))
    comments = normalize_comments(extract_comments_items(comments_json))
    visible_comments = [c for c in comments if c.get('status') == 1]
    contact = normalize_contact(ad.get('contact'))
    now = datetime.now(UTC)

    result = await get_collection().update_one(
        {'_id': post_id},
        {
            '$setOnInsert': {
                '_id': post_id,
                'postId': post_id,
                'firstSeenAt': now,
            },
            '$set': {
                'lastSeenAt': now,
                'url': ad.get('url'),
                'harajUrlId': ad.get('harajUrlId'),
                'sourceTagUrl': ad.get('sourceTagUrl'),
                'contact': contact,
                'phone': contact.get('mobile'),
                'gql': ad.get('gql'),
                'item': item,
                'comments': comments,
                'commentsCount': len(comments),
                'visibleCommentsCount': len(visible_comments),
                'commentsLastFetchedAt': now if isinstance(comments_json, dict) else None,
                'title': item.get('title'),
                'postDate': item.get('postDate'),
                'tags': item.get('tags', []),
                'city': item.get('city'),
                'priceNumeric': item.get('price', {}).get('numeric'),
                'hasPrice': item.get('price', {}).get('numeric') is not None,
            },
        },
        upsert=True,
    )
    return {'inserted': bool(result.upserted_id)}


async def ensure_indexes():
    col = get_collection()
    await col.create_index('postId')
    await col.create_index('harajUrlId')
    await col.create_index('sourceTagUrl')
    await col.create_index('firstSeenAt')
    await col.create_index('lastSeenAt')
    await col.create_index('postDate')
    await col.create_index('city')
    await col.create_index('tags')
    await col.create_index('priceNumeric')
    await col.create_index('contact.mobile')

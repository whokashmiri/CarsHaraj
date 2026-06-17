BASE_URL = 'https://haraj.com.sa/'


def absolute_url(path_or_url: str) -> str:
    value = str(path_or_url or '').strip()
    if value.startswith('http://') or value.startswith('https://'):
        return value
    if value.startswith('/'):
        return BASE_URL.rstrip('/') + value
    return BASE_URL + value


def post_url(post_id: int | str) -> str:
    return f'{BASE_URL}{str(post_id).strip()}'

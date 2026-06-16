import json
import argparse
import requests
import questionary
from functools import partial
from multiprocessing import Pool
from bs4 import BeautifulSoup
from urllib.parse import urljoin
from tqdm import tqdm

BASE_URL = "https://en.volleyballworld.com"
YEARS = [str(y) for y in range(2021, 2027)]

def teams_url(year, category):
    if int(year) == 2026:
        return f"{BASE_URL}/volleyball/competitions/volleyball-nations-league/teams/{category}/"
    return f"{BASE_URL}/volleyball/competitions/volleyball-nations-league/{year}/teams/{category}/"

def parse_player(url, category):
    url = urljoin(BASE_URL, url)
    response = requests.get(url)
    soup = BeautifulSoup(response.content, "html.parser")

    bio_cols = soup.find_all("div", class_="vbw-player-bio-col")
    bio = {}
    for col in bio_cols:
        head = col.find("div", class_="vbw-player-bio-head")
        text = col.find("div", class_="vbw-player-bio-text")
        if head and text:
            bio[head.text.strip()] = text.text.strip()

    img_wrap = soup.find("div", class_="vbw-player-img-wrap")
    img = img_wrap.find("img") if img_wrap else None

    return {
        'nickname': soup.find("span", class_="vbw-player-lastname").text,
        'name': soup.find("span", class_="vbw-player-name").text,
        'number': soup.find("div", class_="vbw-player-no").text,
        'team': soup.find("a", class_="player-team-text").text,
        'category': category,
        'position': bio.get("Position"),
        'birth_date': bio.get("Birth date"),
        'height': bio.get("Height"),
        'picture': img["src"] if img else None,
    }

def get_player_urls(url):
    url = urljoin(BASE_URL, url.replace("schedule", "players"))
    response = requests.get(url)
    soup = BeautifulSoup(response.content, "html.parser")
    links = soup.find("table", class_="vbw-team-roster-table").find_all("a")
    return [link["href"] for link in links]

def fetch_flags(url):
    response = requests.get(url)
    soup = BeautifulSoup(response.content, "html.parser")
    links = soup.find("div", class_="vbw-team-list").find_all("a")
    flags = {}
    for link in links:
        name_div = link.find("div", class_="vbw-mu__team__name")
        flag_img = link.find("div", class_="vbw-mu__team__logo")
        if name_div and flag_img:
            img = flag_img.find("img")
            if img:
                flags[name_div.text.strip()] = img["src"]
    return flags

def extract_flags(soup):
    flags = {}
    for link in soup.find("div", class_="vbw-team-list").find_all("a"):
        name_div = link.find("div", class_="vbw-mu__team__name")
        flag_div = link.find("div", class_="vbw-mu__team__logo")
        if name_div and flag_div:
            img = flag_div.find("img")
            if img:
                flags[name_div.text.strip()] = img["src"]
    return flags

def fetch_flags(url):
    soup = BeautifulSoup(requests.get(url).content, "html.parser")
    return extract_flags(soup)

def parse_teams(url, category, debug=False, threads=18):
    response = requests.get(url)
    soup = BeautifulSoup(response.content, "html.parser")
    links = soup.find("div", class_="vbw-team-list").find_all("a")

    flags = extract_flags(soup)

    team_urls = [urljoin(BASE_URL, link["href"]) for link in links]
    if debug:
        team_urls = team_urls[:1]

    player_urls = []
    for team_url in tqdm(team_urls, desc=f"Collecting {category} rosters"):
        player_urls.extend(get_player_urls(team_url))
    player_urls = list(set(player_urls))
    if debug:
        player_urls = player_urls[:3]

    fn = partial(parse_player, category=category)
    with Pool(threads) as p:
        results = list(tqdm(p.imap_unordered(fn, player_urls), total=len(player_urls), desc=f"Fetching {category} players"))
    return results, flags

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument("--debug", action="store_true", default=False, help="Limit to 1 team and 3 players per category")
    parser.add_argument("--threads", type=int, default=6, help="Number of parallel threads (default: 6)")
    parser.add_argument("--flags-only", action="store_true", default=False, help="Only fetch team flags, skip player scraping")
    args = parser.parse_args()

    year = questionary.select("Select year:", choices=YEARS).ask()
    suffix = "_debug" if args.debug else ""

    if args.flags_only:
        all_flags = {}
        for category in ("men", "women"):
            all_flags.update(fetch_flags(teams_url(year, category)))
        flags_output = f"data/{year}_flags{suffix}.json"
        with open(flags_output, "w") as f:
            json.dump(all_flags, f, indent=2, ensure_ascii=False)
        print(f"Saved {len(all_flags)} flags to {flags_output}")
    else:
        all_players = []
        all_flags = {}
        for category in ("men", "women"):
            url = teams_url(year, category)
            players, flags = parse_teams(url, category, debug=args.debug, threads=args.threads)
            all_players.extend(players)
            all_flags.update(flags)

        output = f"data/{year}{suffix}.json"
        with open(output, "w") as f:
            json.dump(all_players, f, indent=2, ensure_ascii=False)
        print(f"Saved {len(all_players)} players to {output}")

        flags_output = f"data/{year}_flags{suffix}.json"
        with open(flags_output, "w") as f:
            json.dump(all_flags, f, indent=2, ensure_ascii=False)
        print(f"Saved {len(all_flags)} flags to {flags_output}")

# KravN Suggests

Search a movie or series, see posters, cast, trailer and where to watch (TMDB), plus a
"Watch if you like..." list where every pick has a match meter (0-100%).
Save movies to "My list" with the heart button.

## Setup
1. Install JDK 17+ (VS Code: also install "Extension Pack for Java").
2. Get a TMDB "API Read Access Token" (themoviedb.org -> Settings -> API).
3. Copy `secrets.properties.example` to `secrets.properties` and paste:
   tmdb.token=YOUR_TOKEN
   anthropic.api-key=YOUR_ANTHROPIC_KEY   (optional)
4. Open WatchIfYouLikeApplication.java and click Run (or: mvn spring-boot:run)
5. Open http://localhost:8080

## Deploy (Render, free)
See the steps in the chat. Environment variables to set on the host:
  TMDB_TOKEN          your TMDB API Read Access Token
  ANTHROPIC_API_KEY   optional (AI scoring)

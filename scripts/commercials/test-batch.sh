#!/usr/bin/env bash
# Three more test slides (11/23 night) so Horace can judge the look before the 100-slide run. Kind humor only.
cd /mnt/c/Users/Owner/Documents/watson
P=data/family-photos
S="python3 scripts/commercials/slide.py --steps 20 --cfg 2.5"
$S --out test-taylor-5am --prompt "Turn this photo into an epic movie-trailer poster. Keep the man exactly as he is: same face, same hair, same build. He stands heroically at dawn holding a travel coffee mug like a trophy, a pickup truck behind him, dramatic orange sunrise, lens flare. Big bold cinematic title text reads: THE 5 AM GRIND. Small tagline under it reads: HE WAKES BEFORE THE ROOSTER. Fun, warm, family-friendly." $P/taylor-1.jpg
$S --out test-girls-sisters --prompt "Turn this photo into a cheerful 1980s Saturday-morning TV ad still. Keep both girls exactly as they are: same faces, same hair. They give a big thumbs up side by side in a bright pastel studio with sparkles and confetti. Big bubbly retro title text reads: SISTER POWER! A star burst reads: NOW WITH 2X THE SASS. Sweet, kind, family-friendly." $P/tatiyana-katana-dinner.jpg
$S --out test-dogs-security --prompt "Turn this photo into a cheesy 1980s infomercial still. Keep the dog exactly as it is: same face, same fur, same colors. The dog wears tiny aviator sunglasses and a little security guard cap, sitting proudly on a porch under bright studio lights with a starburst background. Big bold retro title text reads: WOLF HALL SECURITY. A yellow burst reads: BARKS AT NOTHING 24/7! Fun, family-friendly." $P/snowball-1.jpg
echo TEST BATCH DONE

/** Daftar lagu per artis atau per genre. */
import React, { useMemo } from 'react';
import { T } from '../../../lib/i18n';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useLibrary } from '../../../lib/library';
import { usePlayer } from '../../../lib/player';
import { TrackRow } from '../../../components/TrackRow';
import { useTrackMenu } from '../../../components/TrackMenu';
import { Collage } from '../../../components/Cover';
import { Button } from '../../../components/Common';
import { C, themed } from '../../../lib/theme';

export default function GroupScreen() {
  const { kind, name } = useLocalSearchParams<{ kind: string; name: string }>();
  const lib = useLibrary();
  const player = usePlayer();
  const menu = useTrackMenu();
  const isArtist = kind === 'artis';

  const list = useMemo(() => [...(lib.tracks || []), ...lib.localTracks]
    .filter((t) => (isArtist ? t.artist || 'Tidak diketahui' : t.genre || 'Tanpa genre') === name)
    .sort((a, b) => a.title.localeCompare(b.title, 'id')), [lib.tracks, lib.localTracks, name, isArtist]);

  return (
    <>
      <Stack.Screen options={{ title: '' }} />
      <FlatList
        data={list}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ paddingBottom: 24 }}
        ListHeaderComponent={
          <View style={s.head}>
            <Collage ids={list.map((t) => t.ytId).filter(Boolean) as string[]} size={150} radius={isArtist ? 75 : 18} icon={isArtist ? 'person' : 'pricetag'} />
            <Text style={s.eyebrow}>{isArtist ? T('ARTIS') : T('GENRE')}</Text>
            <Text style={s.title}>{name}</Text>
            <Text style={s.muted}>{list.length} lagu</Text>
            <View style={s.actions}>
              <Button label={T("Putar")} icon="play" disabled={!list.length} onPress={() => player.playList(list, 0, { shuffle: false, source: String(name) })} style={{ flex: 1 }} />
              <Button label={T("Acak")} icon="shuffle" kind="ghost" disabled={!list.length} onPress={() => player.playList(list, null, { shuffle: true, source: String(name) })} style={{ flex: 1 }} />
            </View>
            <Button label={T("Tambahkan semua ke playlist")} icon="add-circle-outline" kind="ghost" disabled={!list.length} onPress={() => menu.addToPlaylist(list)} style={{ alignSelf: 'stretch' }} />
          </View>
        }
        renderItem={({ item, index }) => (
          <TrackRow showPlaylists track={item} active={player.current?.id === item.id} favorite={lib.favorites.has(item.id)} showSource
            onPress={() => player.playList(list, index, { source: String(name) })}
            onMore={() => menu.open(item, { list, index })} />
        )}
        extraData={player.current?.id}
      />
    </>
  );
}

const s = themed(() => StyleSheet.create({
  head: { alignItems: 'center', padding: 16, gap: 6 },
  eyebrow: { color: C.muted, fontSize: 11, fontWeight: '800', letterSpacing: 1.2, marginTop: 10 },
  title: { color: C.text, fontSize: 28, fontWeight: '800', textAlign: 'center' },
  muted: { color: C.muted },
  actions: { flexDirection: 'row', gap: 10, alignSelf: 'stretch', marginTop: 10 },
}));

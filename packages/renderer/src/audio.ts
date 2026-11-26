import {
	type AudioListener,
	AudioLoader,
	type Object3D,
	PositionalAudio,
} from "three/webgpu";

const buffers = new Map<string, Promise<AudioBuffer>>();

/** Loads `url` (cached) and attaches a (non-looping) `PositionalAudio` to `object`. */
export async function attachSound(
	object: Object3D,
	listener: AudioListener,
	url: string,
): Promise<PositionalAudio> {
	let buffer = buffers.get(url);
	if (!buffer) {
		buffer = new AudioLoader().loadAsync(url);
		buffers.set(url, buffer);
		buffer.catch(() => buffers.delete(url));
	}
	const sound = new PositionalAudio(listener);
	sound.setBuffer(await buffer);
	sound.setRefDistance(2);
	object.add(sound);
	return sound;
}

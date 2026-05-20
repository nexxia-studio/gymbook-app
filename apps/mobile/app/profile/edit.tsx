import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, ScrollView, Pressable, Alert, KeyboardAvoidingView, Platform,
  ActionSheetIOS, Image,
} from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ChevronLeft, Camera, Pencil } from 'lucide-react-native'
import * as ImagePicker from 'expo-image-picker'
import { TextInput } from '../../components/ui/TextInput'
import { Button } from '../../components/ui/Button'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/useAuthStore'

type FocusField = 'photo' | 'phone' | 'birth_date' | 'address' | 'emergency'

interface EditableProfile {
  firstName: string
  lastName: string
  email: string
  phone: string
  dateOfBirth: string
  streetName: string
  streetNumber: string
  postalCode: string
  city: string
  emergencyName: string
  emergencyPhone: string
  avatarUrl: string | null
}

function autoFormatDateInput(text: string): string {
  const digits = text.replace(/\D/g, '').slice(0, 8)
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
}

function isValidDateInput(date: string): boolean {
  const match = date.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!match) return false
  const [, dd, mm, yyyy] = match
  const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00`)
  return !isNaN(d.getTime()) && d.getDate() === Number(dd) && d.getMonth() + 1 === Number(mm)
}

function formatBirthDateForDb(input: string): string | null {
  if (!input.trim()) return null
  const match = input.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!match) return null
  const [, dd, mm, yyyy] = match
  return `${yyyy}-${mm}-${dd}`
}

function formatBirthDateFromDb(value: string | null): string {
  if (!value) return ''
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return ''
  const [, yyyy, mm, dd] = match
  return `${dd}/${mm}/${yyyy}`
}

async function fetchBelgianCityFromPostalCode(code: string): Promise<string | null> {
  if (code.length !== 4) return null
  try {
    const r = await fetch(`https://api.zippopotam.us/BE/${code}`)
    if (!r.ok) return null
    const data = await r.json() as { places?: Array<{ 'place name': string }> }
    return data.places?.[0]?.['place name'] ?? null
  } catch {
    return null
  }
}

function nameToColor(name: string): string {
  const colors = ['#4ECDC4', '#FF6B6B', '#6C5CE7', '#FF8E53', '#A8E6CF', '#B8B8FF']
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return colors[Math.abs(hash) % colors.length]
}

export default function EditProfileScreen() {
  const { t } = useTranslation()
  const router = useRouter()
  const { focus } = useLocalSearchParams<{ focus?: FocusField }>()
  const refreshProfile = useAuthStore((s) => s.refreshProfile)

  const [form, setForm] = useState<EditableProfile>({
    firstName: '', lastName: '', email: '', phone: '',
    dateOfBirth: '',
    streetName: '', streetNumber: '', postalCode: '', city: '',
    emergencyName: '', emergencyPhone: '',
    avatarUrl: null,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [errors, setErrors] = useState<{ birth?: string }>({})

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase
        .from('profiles')
        .select('first_name, last_name, email, phone, date_of_birth, street_name, street_number, postal_code, city, emergency_contact_name, emergency_contact_phone, avatar_url')
        .eq('id', user.id)
        .single()
      if (data) {
        setForm({
          firstName: data.first_name ?? '',
          lastName: data.last_name ?? '',
          email: data.email ?? '',
          phone: data.phone ?? '',
          dateOfBirth: formatBirthDateFromDb(data.date_of_birth),
          streetName: data.street_name ?? '',
          streetNumber: data.street_number ?? '',
          postalCode: data.postal_code ?? '',
          city: data.city ?? '',
          emergencyName: data.emergency_contact_name ?? '',
          emergencyPhone: data.emergency_contact_phone ?? '',
          avatarUrl: data.avatar_url,
        })
      }
      setLoading(false)
    })()
  }, [])

  const autoFocus = (field: FocusField) => !loading && focus === field

  const pickFromLibrary = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) {
      Alert.alert(t('profile.edit.error_title'), t('profile.edit.photo_permission_error'))
      return null
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    })
    if (res.canceled) return null
    return res.assets[0]?.uri ?? null
  }, [t])

  const takePhoto = useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync()
    if (!perm.granted) {
      Alert.alert(t('profile.edit.error_title'), t('profile.edit.photo_permission_error'))
      return null
    }
    const res = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    })
    if (res.canceled) return null
    return res.assets[0]?.uri ?? null
  }, [t])

  const uploadAvatar = useCallback(async (localUri: string): Promise<string | null> => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null
    setUploading(true)
    try {
      const ext = localUri.split('.').pop()?.toLowerCase() ?? 'jpg'
      const path = `${user.id}/${Date.now()}.${ext}`
      const response = await fetch(localUri)
      const arrayBuffer = await response.arrayBuffer()
      const { error } = await supabase.storage
        .from('avatars')
        .upload(path, arrayBuffer, {
          contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
          upsert: true,
        })
      if (error) throw error
      const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path)
      return pub.publicUrl
    } catch (err) {
      console.error('[uploadAvatar]', err)
      Alert.alert(t('profile.edit.error_title'), t('profile.edit.error_message'))
      return null
    } finally {
      setUploading(false)
    }
  }, [t])

  const handleSelectPhoto = useCallback(async () => {
    const choose = async (src: 'camera' | 'library' | 'remove' | 'cancel') => {
      if (src === 'cancel') return
      if (src === 'remove') {
        setForm((f) => ({ ...f, avatarUrl: null }))
        return
      }
      const uri = src === 'camera' ? await takePhoto() : await pickFromLibrary()
      if (!uri) return
      const url = await uploadAvatar(uri)
      if (url) setForm((f) => ({ ...f, avatarUrl: url }))
    }

    if (Platform.OS === 'ios') {
      const options = [
        t('profile.edit.photo_camera'),
        t('profile.edit.photo_library'),
        t('profile.edit.photo_remove'),
        t('profile.edit.photo_cancel'),
      ]
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: t('profile.edit.photo_title'),
          options,
          cancelButtonIndex: 3,
          destructiveButtonIndex: 2,
        },
        (idx) => {
          if (idx === 0) choose('camera')
          else if (idx === 1) choose('library')
          else if (idx === 2) choose('remove')
        },
      )
    } else {
      Alert.alert(t('profile.edit.photo_title'), undefined, [
        { text: t('profile.edit.photo_camera'), onPress: () => choose('camera') },
        { text: t('profile.edit.photo_library'), onPress: () => choose('library') },
        { text: t('profile.edit.photo_remove'), style: 'destructive', onPress: () => choose('remove') },
        { text: t('profile.edit.photo_cancel'), style: 'cancel' },
      ])
    }
  }, [pickFromLibrary, takePhoto, uploadAvatar, t])

  const handleSave = useCallback(async () => {
    const dbBirth = formatBirthDateForDb(form.dateOfBirth)
    if (form.dateOfBirth.trim() && (!dbBirth || !isValidDateInput(form.dateOfBirth))) {
      setErrors({ birth: t('profile.edit.birth_date_invalid') })
      return
    }
    setErrors({})
    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const street = form.streetName.trim()
      const num = form.streetNumber.trim()
      const pc = form.postalCode.trim()
      const cty = form.city.trim()
      const composedAddress = [
        [street, num].filter(Boolean).join(' '),
        [pc, cty].filter(Boolean).join(' '),
      ].filter(Boolean).join(', ')

      const { error } = await supabase
        .from('profiles')
        .update({
          first_name: form.firstName.trim(),
          last_name: form.lastName.trim(),
          phone: form.phone.trim() || null,
          date_of_birth: dbBirth,
          street_name: street || null,
          street_number: num || null,
          postal_code: pc || null,
          city: cty || null,
          address_line: composedAddress || null,
          emergency_contact_name: form.emergencyName.trim() || null,
          emergency_contact_phone: form.emergencyPhone.trim() || null,
          avatar_url: form.avatarUrl,
        })
        .eq('id', user.id)
      if (error) throw error

      await refreshProfile()
      Alert.alert(t('profile.edit.saved_title'), t('profile.edit.saved_message'), [
        { text: 'OK', onPress: () => router.replace('/(tabs)/profile') },
      ])
    } catch (err) {
      console.error('[saveProfile]', err)
      Alert.alert(t('profile.edit.error_title'), t('profile.edit.error_message'))
    } finally {
      setSaving(false)
    }
  }, [form, refreshProfile, router, t])

  const initials = `${form.firstName[0] ?? ''}${form.lastName[0] ?? ''}`.toUpperCase()
  const bgColor = nameToColor(`${form.firstName} ${form.lastName}`)

  return (
    <SafeAreaView className="flex-1 bg-move-dark" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center justify-between bg-move-dark px-5 pb-6 pt-3">
        <Pressable onPress={() => router.replace('/(tabs)/profile')} hitSlop={12}>
          <ChevronLeft size={24} color="#FFFFFF" />
        </Pressable>
        <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 24, color: '#FFFFFF', letterSpacing: 2 }}>
          {t('profile.edit.title').toUpperCase()}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1 bg-move-bg"
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Avatar */}
          <View className="items-center rounded-2xl bg-move-card p-6">
            <Pressable onPress={handleSelectPhoto} disabled={uploading}>
              <View
                className="h-24 w-24 items-center justify-center overflow-hidden rounded-full"
                style={{ backgroundColor: bgColor, borderWidth: 3, borderColor: '#C8F000' }}
              >
                {form.avatarUrl ? (
                  <Image source={{ uri: form.avatarUrl }} className="h-full w-full" />
                ) : (
                  <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 36, color: '#FFFFFF' }}>
                    {initials || '?'}
                  </Text>
                )}
              </View>
              <View className="absolute -bottom-1 -right-1 h-8 w-8 items-center justify-center rounded-full border-2 border-move-card bg-move-dark">
                {uploading ? (
                  <Text style={{ color: '#C8F000', fontSize: 10 }}>...</Text>
                ) : (
                  <Camera size={14} color="#C8F000" />
                )}
              </View>
            </Pressable>
            <Pressable onPress={handleSelectPhoto} disabled={uploading} className="mt-3 flex-row items-center gap-1.5">
              <Pencil size={12} color="#6B6861" />
              <Text className="font-dmsans-medium text-xs text-move-text-secondary">
                {t('profile.edit.edit_photo')}
              </Text>
            </Pressable>
          </View>

          {/* Identity */}
          <View className="gap-4 rounded-2xl bg-move-card p-4">
            <View className="flex-row gap-3">
              <View className="flex-1">
                <TextInput
                  label={t('profile.edit.first_name')}
                  value={form.firstName}
                  onChangeText={(v) => setForm((f) => ({ ...f, firstName: v }))}
                  autoComplete="given-name"
                  editable={!loading}
                />
              </View>
              <View className="flex-1">
                <TextInput
                  label={t('profile.edit.last_name')}
                  value={form.lastName}
                  onChangeText={(v) => setForm((f) => ({ ...f, lastName: v }))}
                  autoComplete="family-name"
                  editable={!loading}
                />
              </View>
            </View>

            <TextInput
              label={t('profile.edit.email')}
              value={form.email}
              editable={false}
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <TextInput
              label={t('profile.edit.phone')}
              placeholder={t('profile.edit.phone_placeholder')}
              value={form.phone}
              onChangeText={(v) => setForm((f) => ({ ...f, phone: v }))}
              keyboardType="phone-pad"
              autoComplete="tel"
              editable={!loading}
              autoFocus={autoFocus('phone')}
            />

            <TextInput
              label={t('profile.edit.birth_date')}
              placeholder={t('profile.edit.birth_date_placeholder')}
              value={form.dateOfBirth}
              onChangeText={(v) => setForm((f) => ({ ...f, dateOfBirth: autoFormatDateInput(v) }))}
              error={errors.birth}
              keyboardType="numeric"
              maxLength={10}
              editable={!loading}
              autoFocus={autoFocus('birth_date')}
            />

            {/* Address — 4 fields */}
            <View className="gap-3">
              <View className="flex-row gap-2">
                <View className="flex-1">
                  <TextInput
                    label={t('profile.edit.street_name')}
                    placeholder={t('profile.edit.street_name_placeholder')}
                    value={form.streetName}
                    onChangeText={(v) => setForm((f) => ({ ...f, streetName: v }))}
                    editable={!loading}
                    autoFocus={autoFocus('address')}
                  />
                </View>
                <View style={{ width: 88 }}>
                  <TextInput
                    label={t('profile.edit.street_number')}
                    placeholder="N°"
                    value={form.streetNumber}
                    onChangeText={(v) => setForm((f) => ({ ...f, streetNumber: v }))}
                    keyboardType="numeric"
                    editable={!loading}
                  />
                </View>
              </View>

              <View className="flex-row gap-2">
                <View style={{ width: 110 }}>
                  <TextInput
                    label={t('profile.edit.postal_code')}
                    placeholder="0000"
                    value={form.postalCode}
                    onChangeText={async (v) => {
                      const digits = v.replace(/\D/g, '').slice(0, 4)
                      setForm((f) => ({ ...f, postalCode: digits }))
                      if (digits.length === 4) {
                        const cityName = await fetchBelgianCityFromPostalCode(digits)
                        if (cityName) setForm((f) => ({ ...f, city: cityName }))
                      }
                    }}
                    keyboardType="numeric"
                    maxLength={4}
                    editable={!loading}
                  />
                </View>
                <View className="flex-1">
                  <TextInput
                    label={t('profile.edit.city')}
                    value={form.city}
                    onChangeText={(v) => setForm((f) => ({ ...f, city: v }))}
                    editable={!loading}
                  />
                </View>
              </View>
            </View>
          </View>

          {/* Emergency */}
          <View className="gap-4 rounded-2xl bg-move-card p-4">
            <Text className="font-dmsans-bold text-base text-move-dark">
              {t('profile.edit.emergency_section')}
            </Text>

            <TextInput
              label={t('profile.edit.emergency_name')}
              value={form.emergencyName}
              onChangeText={(v) => setForm((f) => ({ ...f, emergencyName: v }))}
              editable={!loading}
              autoFocus={autoFocus('emergency')}
            />

            <TextInput
              label={t('profile.edit.emergency_phone')}
              value={form.emergencyPhone}
              onChangeText={(v) => setForm((f) => ({ ...f, emergencyPhone: v }))}
              keyboardType="phone-pad"
              editable={!loading}
            />
          </View>

          {/* Save */}
          <Button
            title={saving ? t('profile.edit.saving') : t('profile.edit.save')}
            onPress={handleSave}
            isLoading={saving}
            disabled={loading || uploading}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}


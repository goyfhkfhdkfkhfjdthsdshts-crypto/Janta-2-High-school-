import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { applyCors, handleCorsOptions } from '@/lib/cors';
import { AboutSchoolData, SchoolFacilityItem, SchoolPhotoItem } from '@/lib/types';

export async function OPTIONS(req: NextRequest) {
  return handleCorsOptions(req);
}

export async function GET(req: NextRequest) {
  try {
    const aboutData = db.getAboutSchool();
    return applyCors(NextResponse.json({ success: true, data: aboutData }), req);
  } catch (error) {
    console.error('Error fetching About School data:', error);
    return applyCors(
      NextResponse.json(
        { success: false, error: 'Failed to fetch school information' },
        { status: 500 }
      ),
      req
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    let body: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return applyCors(
          NextResponse.json(
            { success: false, error: 'Invalid request payload' },
            { status: 400 }
          ),
          req
        );
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return applyCors(
        NextResponse.json(
          { success: false, error: 'Malformed JSON body' },
          { status: 400 }
        ),
        req
      );
    }

    const action = typeof body.action === 'string' ? body.action : undefined;
    const payload =
      body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
        ? (body.payload as Record<string, unknown>)
        : undefined;
    const actor =
      typeof body.performedBy === 'string' && body.performedBy.trim()
        ? body.performedBy.trim()
        : 'School Administrator';

    let aboutData: AboutSchoolData = db.getAboutSchool();

    if (action === 'toggle_highlight') {
      const highlightId = typeof payload?.highlightId === 'string' ? payload.highlightId : '';
      if (!highlightId) {
        return applyCors(
          NextResponse.json(
            { success: false, error: 'highlightId is required' },
            { status: 400 }
          ),
          req
        );
      }
      const isFeatured = Boolean(payload?.isFeatured);
      const updatedHighlights = (aboutData.highlights || []).map((h) =>
        h.id === highlightId ? { ...h, isFeatured } : h
      );
      aboutData = db.updateAboutSchool({ highlights: updatedHighlights }, actor);
      db.logAudit(
        'UPDATE_HIGHLIGHT',
        actor,
        'AboutSchool',
        `Toggled highlight "${highlightId}" featured status to ${isFeatured}`
      );
    } else if (action === 'update_facility') {
      const facility = payload?.facility as SchoolFacilityItem | undefined;
      if (!facility || !facility.id || !facility.title) {
        return applyCors(
          NextResponse.json(
            { success: false, error: 'Valid facility object with id and title is required' },
            { status: 400 }
          ),
          req
        );
      }
      const currentFacilities = [...(aboutData.facilities || [])];
      const index = currentFacilities.findIndex((f) => f.id === facility.id);
      if (index >= 0) {
        currentFacilities[index] = facility;
      } else {
        currentFacilities.push(facility);
      }
      aboutData = db.updateAboutSchool({ facilities: currentFacilities }, actor);
      db.logAudit(
        'UPDATE_FACILITY',
        actor,
        'AboutSchool',
        `Updated school facility "${facility.title}"`
      );
    } else if (action === 'delete_facility') {
      const facilityId = typeof payload?.facilityId === 'string' ? payload.facilityId : '';
      if (!facilityId) {
        return applyCors(
          NextResponse.json(
            { success: false, error: 'facilityId is required' },
            { status: 400 }
          ),
          req
        );
      }
      const filtered = (aboutData.facilities || []).filter((f) => f.id !== facilityId);
      aboutData = db.updateAboutSchool({ facilities: filtered }, actor);
      db.logAudit(
        'DELETE_FACILITY',
        actor,
        'AboutSchool',
        `Deleted school facility id "${facilityId}"`
      );
    } else if (action === 'add_photo') {
      const photo = payload?.photo as SchoolPhotoItem | undefined;
      if (!photo || !photo.title || !photo.imageUrl) {
        return applyCors(
          NextResponse.json(
            { success: false, error: 'Valid photo with title and imageUrl is required' },
            { status: 400 }
          ),
          req
        );
      }
      const normalizedPhoto: SchoolPhotoItem = {
        ...photo,
        id: photo.id || `p-${Date.now()}`,
      };
      const updatedPhotos = [normalizedPhoto, ...(aboutData.photos || [])];
      aboutData = db.updateAboutSchool({ photos: updatedPhotos }, actor);
      db.logAudit(
        'ADD_PHOTO',
        actor,
        'AboutSchool',
        `Added new gallery photo "${normalizedPhoto.title}"`
      );
    } else if (action === 'delete_photo') {
      const photoId = typeof payload?.photoId === 'string' ? payload.photoId : '';
      if (!photoId) {
        return applyCors(
          NextResponse.json(
            { success: false, error: 'photoId is required' },
            { status: 400 }
          ),
          req
        );
      }
      const updatedPhotos = (aboutData.photos || []).filter((p) => p.id !== photoId);
      aboutData = db.updateAboutSchool({ photos: updatedPhotos }, actor);
      db.logAudit(
        'DELETE_PHOTO',
        actor,
        'AboutSchool',
        `Removed photo id "${photoId}"`
      );
    } else if (action === 'update_full') {
      if (!payload) {
        return applyCors(
          NextResponse.json(
            { success: false, error: 'Update payload is required' },
            { status: 400 }
          ),
          req
        );
      }
      aboutData = db.updateAboutSchool(payload as Partial<AboutSchoolData>, actor);
      db.logAudit(
        'UPDATE_ABOUT_SCHOOL',
        actor,
        'AboutSchool',
        'Updated full About School profile details'
      );
    } else {
      const updates = (payload ?? body) as Partial<AboutSchoolData>;
      aboutData = db.updateAboutSchool(updates, actor);
      db.logAudit(
        'UPDATE_ABOUT_SECTION',
        actor,
        'AboutSchool',
        `Updated about school section: ${action || 'general'}`
      );
    }

    return applyCors(NextResponse.json({ success: true, data: aboutData }), req);
  } catch (error) {
    console.error('Error updating About School data:', error);
    return applyCors(
      NextResponse.json(
        { success: false, error: 'Failed to update school information' },
        { status: 500 }
      ),
      req
    );
  }
}

export async function POST(req: NextRequest) {
  return PUT(req);
}

export async function PATCH(req: NextRequest) {
  return PUT(req);
}
